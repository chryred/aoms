use super::{base_labels, MetricSample};
use crate::config::{AgentConfig, ServiceConfig};

#[cfg(target_os = "linux")]
pub fn collect(cfg: &AgentConfig, services: &[ServiceConfig]) -> Vec<MetricSample> {
    use procfs::process::all_processes;

    let base = base_labels(
        &cfg.system_name,
        &cfg.display_name,
        &cfg.instance_role,
        &cfg.host,
    );

    let Ok(procs) = all_processes() else {
        return vec![];
    };

    // Map: service_name → (display_name, total_cpu_ticks, total_rss_kb)
    let mut service_stats: std::collections::HashMap<String, (String, u64, u64)> =
        std::collections::HashMap::new();
    // Unmatched top-N by cpu — (proc_name, pid, cmdline, cpu_ticks, rss_kb)
    let mut unmatched: Vec<(String, u32, String, u64, u64)> = Vec::new();

    let clk_tck = procfs::ticks_per_second() as f64;

    for proc_result in procs {
        let Ok(proc) = proc_result else {
            continue;
        };
        let Ok(stat) = proc.stat() else {
            continue;
        };

        let cpu_ticks = stat.utime + stat.stime;
        let rss_kb = (stat.rss as u64).saturating_mul(4); // 4KB pages typical

        // read cmdline for service matching
        let cmdline = proc
            .cmdline()
            .map(|v| v.join(" "))
            .unwrap_or_default();

        let proc_name = stat.comm.clone();
        let match_str = format!("{} {}", proc_name, cmdline);

        let mut matched = false;
        for svc in services {
            if match_str.contains(&svc.process_match) {
                let entry = service_stats
                    .entry(svc.name.clone())
                    .or_insert((svc.display_name.clone(), 0, 0));
                entry.1 += cpu_ticks;
                entry.2 += rss_kb;
                matched = true;
                break;
            }
        }
        if !matched {
            let cmd_truncated = if cmdline.len() > 200 {
                cmdline[..200].to_string()
            } else {
                cmdline
            };
            unmatched.push((proc_name, stat.pid as u32, cmd_truncated, cpu_ticks, rss_kb));
        }
    }

    let mut samples = Vec::new();

    // Emit service-mapped metrics
    for (svc_name, (svc_display, cpu_ticks, rss_kb)) in &service_stats {
        let cpu_percent = (*cpu_ticks as f64 / clk_tck / cfg.collect_interval_secs as f64 * 100.0)
            .clamp(0.0, 400.0); // multi-core can exceed 100%

        let mut lbs_cpu = base.clone();
        lbs_cpu.push(("process".to_string(), svc_name.clone()));
        lbs_cpu.push(("service_name".to_string(), svc_name.clone()));
        lbs_cpu.push(("service_display".to_string(), svc_display.clone()));

        let mut lbs_mem = lbs_cpu.clone();

        samples.push(MetricSample::new(
            "process_cpu_percent",
            lbs_cpu,
            cpu_percent,
        ));
        samples.push(MetricSample::new(
            "process_memory_bytes",
            lbs_mem,
            *rss_kb as f64 * 1024.0,
        ));
    }

    // Top-N unmatched processes by cpu
    unmatched.sort_by(|a, b| b.3.cmp(&a.3));
    for (proc_name, pid, cmdline, cpu_ticks, rss_kb) in unmatched.iter().take(cfg.top_process_count) {
        let cpu_percent = (*cpu_ticks as f64 / clk_tck / cfg.collect_interval_secs as f64 * 100.0)
            .clamp(0.0, 400.0);

        let mut lbs_cpu = base.clone();
        lbs_cpu.push(("process".to_string(), proc_name.clone()));
        lbs_cpu.push(("pid".to_string(), pid.to_string()));
        lbs_cpu.push(("command".to_string(), cmdline.clone()));
        lbs_cpu.push(("service_name".to_string(), "".to_string()));
        lbs_cpu.push(("service_display".to_string(), "".to_string()));

        let mut lbs_mem = lbs_cpu.clone();

        samples.push(MetricSample::new("process_cpu_percent", lbs_cpu, cpu_percent));
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
