export function summarizeOverall(groups) {
    if (groups.some(group => group.level === "required" && !group.satisfied))
        return "blocked";
    return groups.some(group => group.level !== "required" && !group.ideal) ? "warning" : "ok";
}
export function doctorExitCode(report) {
    return report.overall === "blocked" ? 1 : 0;
}
export function printDoctorReport(report, opts) {
    console.log("");
    console.log(`  Setup status: ${report.overall}`);
    for (const group of report.groups) {
        console.log(`  ${formatGroupTitle(group)} [${group.passed}/${group.idealOk ?? group.minOk}]`);
        for (const check of group.checks)
            printDoctorCheck(check, opts.installHints);
    }
    console.log("");
}
function formatGroupTitle(group) {
    let suffix = "optional";
    if (group.level === "required")
        suffix = "required";
    else if (group.level === "recommended")
        suffix = "recommended";
    return `${group.label} (${suffix})`;
}
function printDoctorCheck(check, installHints) {
    const detail = check.detail ? ` - ${check.detail}` : "";
    console.log(`    [${renderStatus(check.status)}] ${check.label}${detail}`);
    if (!installHints || check.status === "ok" || !check.remedy)
        return;
    console.log(`      hint: ${check.remedy.hint}`);
    if (check.remedy.command)
        console.log(`      cmd:  ${check.remedy.command}`);
    if (check.remedy.url)
        console.log(`      url:  ${check.remedy.url}`);
}
function renderStatus(status) {
    switch (status) {
        case "ok":
            return "OK";
        case "missing":
            return "MISSING";
        case "misconfigured":
            return "MISCONFIGURED";
        case "skipped":
            return "SKIPPED";
        case "unknown":
            return "UNKNOWN";
        case "uninitialized":
            return "UNINITIALIZED";
    }
}
