import { execFileSync } from "node:child_process";

export async function resolveMongoUri(uri) {
  if (process.platform !== "win32" || !uri.startsWith("mongodb+srv://")) return uri;
  const match = /^mongodb\+srv:\/\/([^/?#]+)(.*)$/i.exec(uri);
  if (!match) return uri;
  const authority = match[1];
  const host = authority.slice(authority.lastIndexOf("@") + 1).split(":")[0].toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error("Invalid MongoDB Atlas hostname");
  const powershell = (queryName, recordType, server) => {
    const script = `$records = @(Resolve-DnsName -Name '${queryName}' -Type ${recordType} -Server ${server} -DnsOnly -ErrorAction Stop); if ('${recordType}' -eq 'SRV') { @($records | Where-Object Type -eq 'SRV' | Select-Object NameTarget,Port) | ConvertTo-Json -Compress } else { @($records | Where-Object Type -eq 'TXT' | ForEach-Object { $_.Strings -join '' }) | ConvertTo-Json -Compress }`;
    return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 10000 }).trim() || "[]");
  };
  let records; let txt = [];
  const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
  if (process.platform === "win32") {
    let lastError;
    for (const server of ["8.8.8.8", "1.1.1.1"]) {
      try {
        records = asArray(powershell(`_mongodb._tcp.${host}`, "SRV", server));
        txt = asArray(powershell(host, "TXT", server)).map((value) => [value]);
        break;
      } catch (error) { lastError = error; }
    }
    if (!records?.length) throw new Error(`Could not resolve Atlas SRV records. Check DNS/network access. ${lastError?.message || "No SRV records returned"}`);
  }
  if (!records?.length) throw new Error("MongoDB Atlas returned no SRV hosts");
  const credentials = authority.includes("@") ? authority.slice(0, authority.lastIndexOf("@") + 1) : "";
  const hosts = records.map((record) => `${String(record.name || record.NameTarget).replace(/\.$/, "")}:${record.port || record.Port}`).join(",");
  let suffix = match[2] || "/";
  const queryIndex = suffix.indexOf("?");
  const query = new URLSearchParams(queryIndex >= 0 ? suffix.slice(queryIndex + 1) : "");
  for (const pair of txt.flat().join("").split("&")) {
    if (!pair) continue;
    const splitAt = pair.indexOf("="); const key = splitAt < 0 ? pair : pair.slice(0, splitAt);
    if (!query.has(key)) query.append(key, splitAt < 0 ? "" : pair.slice(splitAt + 1));
  }
  if (!query.has("tls") && !query.has("ssl")) query.set("tls", "true");
  const path = queryIndex >= 0 ? suffix.slice(0, queryIndex) : suffix;
  suffix = `${path || "/"}?${query.toString()}`;
  console.warn("Using Windows DNS fallback to resolve MongoDB Atlas SRV records.");
  return `mongodb://${credentials}${hosts}${suffix}`;
}
