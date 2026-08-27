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
    // (pid, ppid, proc_name, cmdline, curr_ticks, rss_kb, state)
    let mut active: Vec<(u32, u32, String, String, u64, u64, char)> = Vec::new();
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
        let ppid = stat.ppid as u32;
        let state = stat.state;

        let cmdline = proc
            .cmdline()
            .map(|v| v.join(" "))
            .unwrap_or_default();
        let proc_name = stat.comm.clone();

        current_prev.insert(pid, (cpu_ticks, now));
        active.push((pid, ppid, proc_name, cmdline, cpu_ticks, rss_kb, state));
    }

    // Compute per-PID cpu% using delta vs previous snapshot
    let mutex = PREV.get_or_init(|| Mutex::new(HashMap::new()));
    let mut prev_guard = mutex.lock().unwrap();

    // 좀비 프로세스 카운트 (state == 'Z') — CPU/메모리 계산과 무관하게 집계
    let zombie_count = active.iter().filter(|(_, _, _, _, _, _, s)| *s == 'Z').count() as f64;

    // 좀비 부모 귀속 — 어느 프로세스가 자식을 회수(wait)하지 못하는지 특정한다.
    // OOM으로 자식이 죽은 뒤 부모가 wait()를 못 하는 패턴을 서비스 단위로 추적하기 위한 것.
    // active가 아래 집계 루프에서 소비되므로 여기서 emit용 행을 미리 만들어 둔다.
    // (parent_process, parent_pid, count, service_name, service_display)
    const ZOMBIE_TOP_PARENTS: usize = 5;
    let mut zombie_parent_rows: Vec<(String, u32, u32, String, String)> = Vec::new();
    if zombie_count > 0.0 {
        let mut by_parent: HashMap<u32, u32> = HashMap::new();
        for (_pid, ppid, _name, _cmd, _ticks, _rss, state) in &active {
            if *state == 'Z' {
                *by_parent.entry(*ppid).or_insert(0) += 1;
            }
        }

        let pid_index: HashMap<u32, usize> = active
            .iter()
            .enumerate()
            .map(|(i, p)| (p.0, i))
            .collect();

        let mut parents: Vec<(u32, u32)> = by_parent.into_iter().collect();
        // 좀비 수 내림차순 → 상위 N개만. 카디널리티 상한.
        parents.sort_by(|a, b| b.1.cmp(&a.1));

        for (ppid, count) in parents.into_iter().take(ZOMBIE_TOP_PARENTS) {
            // 부모가 이미 죽어 재양육된 경우(ppid=1) 등 조회 실패는 "unknown"으로 둔다.
            let (parent_name, match_str) = match pid_index.get(&ppid) {
                Some(&i) => (
                    active[i].2.clone(),
                    format!("{} {}", active[i].2, active[i].3),
                ),
                None => ("unknown".to_string(), String::new()),
            };
            // 서비스 매핑은 아래 집계 루프와 동일한 process_match 규칙을 따른다.
            let (svc_name, svc_display) = services
                .iter()
                .find(|svc| match_str.contains(&svc.process_match))
                .map(|svc| (svc.name.clone(), svc.display_name.clone()))
                .unwrap_or_default();
            zombie_parent_rows.push((parent_name, ppid, count, svc_name, svc_display));
        }
    }

    let mut pid_cpu: HashMap<u32, f64> = HashMap::new();
    for (pid, _ppid, _name, _cmd, curr_ticks, _rss, _state) in &active {
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

    for (pid, _ppid, proc_name, cmdline, _curr_ticks, rss_kb, _state) in active {
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

    // 좀비 프로세스 카운트 emit (samples 선언 이후)
    // 0이어도 매 주기 emit — alert rule이 absent() 없이 단순 비교식을 쓸 수 있고
    // 그래프 연속성이 확보된다.
    samples.push(MetricSample::new("process_zombie_count", base.clone(), zombie_count));

    // 좀비 부모 귀속 emit — 좀비가 있을 때만 시계열이 생긴다(정상 운영 시 카디널리티 0).
    for (parent_name, ppid, count, svc_name, svc_display) in zombie_parent_rows {
        let mut lbs = base.clone();
        lbs.push(("parent_process".to_string(), parent_name));
        lbs.push(("parent_pid".to_string(), ppid.to_string()));
        lbs.push(("service_name".to_string(), svc_name));
        lbs.push(("service_display".to_string(), svc_display));
        samples.push(MetricSample::new(
            "process_zombie_by_parent",
            lbs,
            count as f64,
        ));
    }

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

    // CPU top-N + 메모리 top-N 합집합 — 모드별로 중요한 프로세스를 모두 포함
    let n = cfg.top_process_count;
    let mut by_cpu = unmatched.clone();
    by_cpu.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));
    let mut by_mem = unmatched;
    by_mem.sort_by(|a, b| b.4.partial_cmp(&a.4).unwrap_or(std::cmp::Ordering::Equal));

    let mut seen_pids = std::collections::HashSet::new();
    let top_union: Vec<_> = by_cpu
        .iter()
        .take(n)
        .chain(by_mem.iter().take(n))
        .filter(|p| seen_pids.insert(p.1))
        .collect();

    for (proc_name, pid, cmdline, cpu_percent, rss_kb) in top_union {
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
