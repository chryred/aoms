use super::{base_labels, MetricSample};
use crate::config::{AgentConfig, ServiceConfig};

#[cfg(target_os = "linux")]
pub fn collect(cfg: &AgentConfig, services: &[ServiceConfig]) -> Vec<MetricSample> {
    use procfs::process::all_processes;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::Instant;

    // PID → (cumulative utime+stime, snapshot time) from previous collection.
    // cpu.rs와 동일한 delta 계산 패턴 — 누적 틱이 아닌 수집 간격 간 delta를 사용해야
    // `cpu_percent`가 실제 CPU 사용률을 반영한다.
    static PREV: OnceLock<Mutex<HashMap<u32, (u64, Instant)>>> = OnceLock::new();

    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );

    let Ok(procs) = all_processes() else {
        return vec![];
    };

    let clk_tck = procfs::ticks_per_second() as f64;
    let now = Instant::now();

    // Gather current snapshot for every process
    // (pid, proc_name, cmdline, curr_ticks, rss_kb)
    let mut active: Vec<(u32, String, String, u64, u64)> = Vec::new();
    let mut current_prev: HashMap<u32, (u64, Instant)> = HashMap::new();

    for proc_result in procs {
        let Ok(proc) = proc_result else {
            continue;
        };
        let Ok(stat) = proc.stat() else {
            continue;
        };

        let cpu_ticks = stat.utime + stat.stime;
        let rss_kb = (stat.rss as u64).saturating_mul(4); // 4KB pages typical
        let pid = stat.pid as u32;

        let cmdline = proc
            .cmdline()
            .map(|v| v.join(" "))
            .unwrap_or_default();
        let proc_name = stat.comm.clone();

        current_prev.insert(pid, (cpu_ticks, now));
        active.push((pid, proc_name, cmdline, cpu_ticks, rss_kb));
    }

    // Compute per-PID cpu% using delta vs previous snapshot
    let mutex = PREV.get_or_init(|| Mutex::new(HashMap::new()));
    let mut prev_guard = mutex.lock().unwrap();

    let mut pid_cpu: HashMap<u32, f64> = HashMap::new();
    for (pid, _name, _cmd, curr_ticks, _rss) in &active {
        if let Some((prev_ticks, prev_time)) = prev_guard.get(pid) {
            let delta_secs = now.duration_since(*prev_time).as_secs_f64();
            if delta_secs > 0.0 {
                let delta_ticks = curr_ticks.saturating_sub(*prev_ticks);
                let cpu_pct = (delta_ticks as f64 / clk_tck / delta_secs * 100.0)
                    .clamp(0.0, 400.0);
                pid_cpu.insert(*pid, cpu_pct);
            }
        }
        // 첫 관측 PID는 이번 수집에서 CPU% 샘플을 방출하지 않음 — 다음 수집부터 delta 가능
    }

    // Replace PREV with current snapshot — 사라진 PID는 자동 GC
    *prev_guard = current_prev;
    drop(prev_guard);

    // Aggregate by service; track unmatched for top-N
    let mut service_stats: HashMap<String, (String, f64, u64)> = HashMap::new();
    let mut unmatched: Vec<(String, u32, String, f64, u64)> = Vec::new();

    for (pid, proc_name, cmdline, _curr_ticks, rss_kb) in active {
        let Some(cpu_pct) = pid_cpu.get(&pid).copied() else {
            continue; // 첫 관측 PID — CPU delta 없음. 이번 round는 skip
        };

        let match_str = format!("{} {}", proc_name, cmdline);

        let mut matched = false;
        for svc in services {
            if match_str.contains(&svc.process_match) {
                let entry = service_stats
                    .entry(svc.name.clone())
                    .or_insert((svc.display_name.clone(), 0.0, 0));
                entry.1 += cpu_pct;
                entry.2 += rss_kb;
                matched = true;
                break;
            }
        }
        if !matched {
            let cmd_truncated = if cmdline.len() > 200 {
                let mut end = 200;
                while !cmdline.is_char_boundary(end) {
                    end -= 1;
                }
                cmdline[..end].to_string()
            } else {
                cmdline
            };
            unmatched.push((proc_name, pid, cmd_truncated, cpu_pct, rss_kb));
        }
    }

    let mut samples = Vec::new();

    // Emit service-mapped metrics
    for (svc_name, (svc_display, cpu_percent, rss_kb)) in &service_stats {
        let mut lbs_cpu = base.clone();
        lbs_cpu.push(("process".to_string(), svc_name.clone()));
        lbs_cpu.push(("service_name".to_string(), svc_name.clone()));
        lbs_cpu.push(("service_display".to_string(), svc_display.clone()));

        let lbs_mem = lbs_cpu.clone();

        samples.push(MetricSample::new(
            "process_cpu_percent",
            lbs_cpu,
            (*cpu_percent).clamp(0.0, 400.0),
        ));
        samples.push(MetricSample::new(
            "process_memory_bytes",
            lbs_mem,
            *rss_kb as f64 * 1024.0,
        ));
    }

    // Top-N unmatched processes by cpu
    unmatched.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));
    for (proc_name, pid, cmdline, cpu_percent, rss_kb) in
        unmatched.iter().take(cfg.top_process_count)
    {
        let mut lbs_cpu = base.clone();
        lbs_cpu.push(("process".to_string(), proc_name.clone()));
        lbs_cpu.push(("pid".to_string(), pid.to_string()));
        lbs_cpu.push(("command".to_string(), cmdline.clone()));
        lbs_cpu.push(("service_name".to_string(), "".to_string()));
        lbs_cpu.push(("service_display".to_string(), "".to_string()));

        let lbs_mem = lbs_cpu.clone();

        samples.push(MetricSample::new("process_cpu_percent", lbs_cpu, *cpu_percent));
        samples.push(MetricSample::new(
            "process_memory_bytes",
            lbs_mem,
            *rss_kb as f64 * 1024.0,
        ));
    }

    samples
}

#[cfg(not(target_os = "linux"))]
pub fn collect(_cfg: &AgentConfig, _services: &[ServiceConfig]) -> Vec<MetricSample> {
    vec![]
}
