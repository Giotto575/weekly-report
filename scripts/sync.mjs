import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));
const TOKEN = process.env.TENCENT_DOCS_TOKEN;
const MCP_URL = process.env.TENCENT_DOCS_MCP_URL || 'https://docs.qq.com/openapi/mcp';

if (!TOKEN) {
  throw new Error('缺少 TENCENT_DOCS_TOKEN。请在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加。');
}

let rpcId = 1;
let sessionId = '';
let protocolVersion = '2025-06-18';

function parseRpcPayload(raw, contentType, expectedId) {
  if (!raw.trim()) return null;
  if ((contentType || '').includes('text/event-stream') || raw.includes('\ndata:')) {
    const events = raw.split(/\r?\n\r?\n/);
    const payloads = [];
    for (const event of events) {
      const data = event.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try { payloads.push(JSON.parse(data)); } catch {}
    }
    if (expectedId != null) return payloads.find(x => x?.id === expectedId) || payloads.at(-1) || null;
    return payloads.at(-1) || null;
  }
  return JSON.parse(raw);
}

async function postRpc(message, { allowEmpty = false } = {}) {
  const headers = {
    'Authorization': TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });

  const newSession = r.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;
  const raw = await r.text();
  if (!r.ok) throw new Error(`腾讯文档 MCP HTTP ${r.status}: ${raw.slice(0, 600)}`);
  if (!raw.trim() && allowEmpty) return null;
  const payload = parseRpcPayload(raw, r.headers.get('content-type'), message.id);
  if (payload?.error) throw new Error(`腾讯文档 MCP 错误 ${payload.error.code ?? ''}: ${payload.error.message || JSON.stringify(payload.error)}`);
  return payload;
}

async function initialize() {
  const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
  let lastError;
  for (const v of versions) {
    protocolVersion = v;
    sessionId = '';
    try {
      const id = rpcId++;
      const reply = await postRpc({
        jsonrpc: '2.0', id, method: 'initialize',
        params: {
          protocolVersion: v,
          capabilities: {},
          clientInfo: { name: 'github-weekly-dashboard-sync', version: '1.0.0' }
        }
      });
      protocolVersion = reply?.result?.protocolVersion || v;
      await postRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { allowEmpty: true });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('无法初始化腾讯文档 MCP。');
}

async function rpc(method, params = {}) {
  const id = rpcId++;
  const reply = await postRpc({ jsonrpc: '2.0', id, method, params });
  return reply?.result;
}

async function listTools() {
  const result = await rpc('tools/list', {});
  return result?.tools || [];
}

function chooseTool(tools, kind) {
  const names = kind === 'info'
    ? ['getsheetinfo', 'sheet.getsheetinfo', 'sheet.get_sheet_info']
    : ['getsheetrange', 'sheet.getsheetrange', 'sheet.get_sheet_range'];
  for (const wanted of names) {
    const hit = tools.find(t => String(t.name).toLowerCase() === wanted);
    if (hit) return hit.name;
  }
  const hit = tools.find(t => {
    const s = `${t.name || ''} ${t.description || ''}`.toLowerCase();
    return kind === 'info'
      ? /sheet/.test(s) && /(info|信息|子表|工作表)/.test(s) && !/(range|范围|update|更新)/.test(s)
      : /sheet/.test(s) && /(range|范围)/.test(s) && /(get|read|获取|读取)/.test(s);
  });
  if (hit) return hit.name;
  const sheetNames = tools.map(t => t.name).filter(n => /sheet/i.test(n)).join(', ');
  throw new Error(`没有识别到腾讯文档 ${kind === 'info' ? 'GetSheetInfo' : 'GetSheetRange'} 工具。当前与 sheet 相关工具：${sheetNames || '无'}`);
}

function unpackToolResult(result) {
  if (result == null) return result;
  if (result.structuredContent != null) return result.structuredContent;
  const texts = (result.content || []).filter(x => x?.type === 'text' && x.text).map(x => x.text.trim());
  for (const text of texts) {
    try { return JSON.parse(text); } catch {}
  }
  return texts.length === 1 ? texts[0] : result;
}

async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  const payload = unpackToolResult(result);
  if (payload?.error) throw new Error(`${name}: ${payload.error}`);
  return payload;
}

function scalar(v) {
  if (v == null) return '';
  if (['string', 'number', 'boolean'].includes(typeof v)) return String(v);
  if (Array.isArray(v)) return v.map(scalar).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    for (const k of ['formatted_value','formattedValue','display_value','displayValue','text','content','value','v']) {
      if (v[k] != null) return scalar(v[k]);
    }
  }
  return '';
}

function normalizeWeeks(values) {
  if (!Array.isArray(values)) return [];
  let lastYear = '', lastMonth = '';
  const weeks = [];
  for (const input of values) {
    if (!Array.isArray(input)) continue;
    const row = input.map(scalar);
    while (row.length < 22) row.push('');
    const year = row[0].trim() || lastYear;
    const month = row[2].trim() || lastMonth;
    const week = row[3].trim();
    if (year) lastYear = year;
    if (month) lastMonth = month;
    if (!week || /具体周|周次|week/i.test(week)) continue;

    const attendance = row.slice(4, 18).map(v => v.trim());
    const monthlyPlan = row[18].trim();
    const completed = row[19].trim();
    const problems = row[20].trim();
    const nextPlan = row[21].trim();
    if (!/[0-9]/.test(week) && !attendance.some(Boolean) && !monthlyPlan && !completed && !problems && !nextPlan) continue;
    weeks.push({ year, month, week, attendance, monthlyPlan, completed, problems, nextPlan });
  }
  return weeks;
}

function getSheets(payload) {
  const sheets = payload?.sheet_info?.sheets || payload?.sheetInfo?.sheets || payload?.sheets || [];
  if (!Array.isArray(sheets)) return [];
  return sheets.map(s => ({
    id: String(s.sheet_id ?? s.sheetId ?? s.id ?? ''),
    name: String(s.title ?? s.name ?? s.sheet_name ?? s.sheetName ?? '')
  })).filter(s => s.id && s.name);
}

function getValues(payload) {
  const candidates = [
    payload?.range_data?.values,
    payload?.rangeData?.values,
    payload?.values,
    payload?.data?.values,
  ];
  const matrix = candidates.find(Array.isArray);
  return matrix || [];
}

function selectedSheet(sheet) {
  const include = Array.isArray(config.includeSheets) ? config.includeSheets : [];
  const exclude = Array.isArray(config.excludeSheets) ? config.excludeSheets : [];
  if (include.length && !include.includes(sheet.name) && !include.includes(sheet.id)) return false;
  if (exclude.includes(sheet.name) || exclude.includes(sheet.id)) return false;
  return true;
}

await initialize();
const tools = await listTools();
const infoTool = chooseTool(tools, 'info');
const rangeTool = chooseTool(tools, 'range');

console.log(`使用腾讯文档工具：${infoTool} / ${rangeTool}`);
const info = await callTool(infoTool, { file_id: config.fileId });
const sheets = getSheets(info).filter(selectedSheet);
if (!sheets.length) throw new Error('没有读取到任何工作表。请检查文档权限，或检查 config.json 的 includeSheets/excludeSheets。');

const people = [];
for (const sheet of sheets) {
  console.log(`读取：${sheet.name} (${sheet.id})`);
  const payload = await callTool(rangeTool, {
    file_id: config.fileId,
    sheet_id: sheet.id,
    range: config.range || 'A1:V450'
  });
  const weeks = normalizeWeeks(getValues(payload));
  people.push({ id: sheet.id, name: sheet.name, weeks });
}

const output = {
  source: 'Tencent Docs online spreadsheet',
  fileId: config.fileId,
  syncedAt: new Date().toISOString(),
  people
};

await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
await fs.writeFile(path.join(ROOT, 'data', 'data.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`同步完成：${people.length} 个工作表，${people.reduce((n,p)=>n+p.weeks.length,0)} 条周记录。`);
