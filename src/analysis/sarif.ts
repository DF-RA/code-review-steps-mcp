import { toRelative, type Finding, type Severity } from "./types.js";

/**
 * Minimal SARIF reader, enough for the tools that emit it (detekt, Semgrep).
 * SARIF puts rule metadata in the run, and the locations in each result.
 */
interface SarifLog {
  runs?: {
    tool?: { driver?: { rules?: SarifRule[] } };
    results?: SarifResult[];
  }[];
}

interface SarifRule {
  id?: string;
  helpUri?: string;
  properties?: { problem?: { severity?: string } };
  defaultConfiguration?: { level?: string };
}

interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: {
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number; endLine?: number };
    };
  }[];
}

function severityFromLevel(level?: string): Severity {
  switch ((level ?? "").toLowerCase()) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    default:
      return "low";
  }
}

export function parseSarif(log: SarifLog, tool: string, cwd: string): Finding[] {
  const findings: Finding[] = [];

  for (const run of log.runs ?? []) {
    const rules = new Map<string, SarifRule>();

    for (const rule of run.tool?.driver?.rules ?? []) {
      if (rule.id) {
        rules.set(rule.id, rule);
      }
    }

    for (const result of run.results ?? []) {
      const location = result.locations?.[0]?.physicalLocation;
      const uri = location?.artifactLocation?.uri;

      if (!uri) {
        continue;
      }

      const rule = result.ruleId ? rules.get(result.ruleId) : undefined;
      const line = location?.region?.startLine ?? 0;

      findings.push({
        tool,
        path: toRelative(uri.replace(/^file:\/\//, ""), cwd),
        line,
        endLine: location?.region?.endLine ?? line,
        rule: result.ruleId ?? "desconocida",
        severity: severityFromLevel(result.level ?? rule?.defaultConfiguration?.level),
        message: (result.message?.text ?? "").trim(),
        url: rule?.helpUri,
      });
    }
  }

  return findings;
}
