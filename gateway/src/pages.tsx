import type { Child } from "hono/jsx";
import { html } from "hono/html";
import { minutesToTime } from "./time";

const REPOSITORY_URL = "https://github.com/frankie0736/wx-clawbot-notify-webhook";

const CSS = `
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f4f7fb;color-scheme:light}
*{box-sizing:border-box}body{min-height:100vh;margin:0;display:flex;flex-direction:column}a{color:#1769e0}.page{flex:1}.shell{width:min(1040px,100%);margin:auto;padding:28px 20px 60px}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px}.brand{font-size:20px;font-weight:800}.muted{color:#65728a;font-size:14px;line-height:1.55}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}.card{background:#fff;border:1px solid #dbe2ee;border-radius:14px;padding:20px;box-shadow:0 10px 30px #1b2a450a}
.auth{width:min(440px,100%);margin:8vh auto}.auth .card{padding:28px}h1{font-size:26px;margin:0 0 8px}h2{font-size:17px;margin:0 0 12px}label{display:block;font-size:13px;font-weight:700;margin:14px 0 6px}
input,textarea,button{font:inherit;border-radius:8px}input,textarea{width:100%;padding:10px 11px;border:1px solid #b9c5d7;background:#fff}textarea{min-height:180px;resize:vertical}button{border:0;padding:10px 14px;background:#1769e0;color:#fff;font-weight:700;cursor:pointer}.secondary{background:#5a6577}.danger{background:#b83333}.row{display:flex;gap:9px;align-items:end}.row>*{flex:1}.row button{flex:0 0 auto}
.status{margin:12px 0 0;padding:10px;border-radius:8px;background:#eef4ff;white-space:pre-wrap;font-size:14px}.error{background:#fff0f0;color:#a12b2b}.ok{background:#e8f7ed;color:#176a35}.key{font-family:ui-monospace,SFMono-Regular,monospace}.hidden{display:none}#qr svg{width:min(280px,100%);height:auto;margin:12px auto;display:block}nav{display:flex;gap:10px;align-items:center}.pill{padding:5px 9px;border-radius:999px;background:#e9eef6;font-size:12px}code{background:#edf1f7;padding:2px 5px;border-radius:4px}
.site-footer{padding:18px 20px 24px;text-align:center}.github-link{display:inline-flex;color:#65728a;transition:color .15s ease}.github-link:hover{color:#172033}.github-link svg{width:24px;height:24px;fill:currentColor}
`;

function Layout(props: { title: string; children: Child; script?: string }) {
  return <html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>{props.title}</title><style>{CSS}</style></head>
    <body><div class="page">{props.children}</div><footer class="site-footer"><a class="github-link" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="GitHub 仓库"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .7C5.7.7.6 5.8.6 12.1c0 5 3.3 9.3 7.8 10.8.6.1.8-.3.8-.6v-2.4c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3 0 0 1-.3 3.2 1.2A11 11 0 0 1 12 6.8c1 0 2 .1 2.9.4 2.2-1.5 3.2-1.2 3.2-1.2.6 1.5.2 2.7.1 3 .8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .4.2.7.8.6a11.5 11.5 0 0 0 7.8-10.8C23.4 5.8 18.3.7 12 .7Z"/></svg></a></footer>{props.script ? <script dangerouslySetInnerHTML={{ __html: props.script }}/> : null}</body></html>;
}

const authScript = `
const f=document.querySelector('form'),s=document.querySelector('#status');
f.onsubmit=async(e)=>{e.preventDefault();s.textContent='处理中…';s.className='status';const body=Object.fromEntries(new FormData(f));
const register=f.dataset.mode==='register';const r=await fetch(register?'/api/register':'/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(register?body:{email:body.email,password:body.password})});
const d=await r.json().catch(()=>({error:'请求失败'}));if(!r.ok){s.textContent=d.message||d.error||'请求失败';s.className='status error';return}location.href='/dashboard'};`;

export function loginPage() {
  return <Layout title="登录 - 微信通知 Gateway" script={authScript}><main class="auth"><section class="card"><h1>登录</h1><p class="muted">使用邮箱和密码进入你的通知 Gateway。</p>
    <form data-mode="login"><label>邮箱</label><input name="email" type="email" required autocomplete="email"/><label>密码</label><input name="password" type="password" required autocomplete="current-password"/><button type="submit" style="margin-top:18px;width:100%">登录</button></form>
    <div id="status" class="status hidden"></div><p class="muted">还没有账号？<a href="/register">使用邀请码注册</a></p></section></main></Layout>;
}

export function registerPage(invite: string) {
  return <Layout title="注册 - 微信通知 Gateway" script={authScript}><main class="auth"><section class="card"><h1>注册</h1><p class="muted">需要一次性邀请码。邮箱暂不验证；密码至少 12 位，不能是纯数字或包含邮箱用户名。</p>
    <form data-mode="register"><label>邮箱</label><input name="email" type="email" required autocomplete="email"/><label>中国大陆手机号（可选）</label><input name="phone" inputmode="tel" pattern="1[3-9][0-9]{9}"/><label>密码</label><input name="password" type="password" minlength={12} maxlength={128} required autocomplete="new-password"/><label>邀请码</label><input name="invitationCode" value={invite} required autocomplete="off"/><button type="submit" style="margin-top:18px;width:100%">注册并登录</button></form>
    <div id="status" class="status hidden"></div><p class="muted"><a href="/login">返回登录</a></p></section></main></Layout>;
}

interface DashboardProps { email: string; role: "user" | "admin"; origin: string; quietStart: number; quietEnd: number; bindingStatus: "pending_context" | "active" | "reauth_required" | null; phone: string | null }

export function apiMarkdown(origin: string): string {
  return `# 微信通知 Webhook API

Base URL: ${origin}

所有通知只会发送到 API Key 所属用户绑定的微信，调用方不能指定收件人。

## 鉴权

\`Authorization: Bearer <用户 API Key>\`

用户可在后台随时查看、复制或 Rotate API Key。Rotate 后旧 Key 立即失效。

## 发送文字通知

\`POST /api/v1/notify\`

\`\`\`http
Authorization: Bearer <用户 API Key>
Content-Type: application/json
Idempotency-Key: crm:lead:8392  # 可选
\`\`\`

\`\`\`json
{
  "text": "**部署完成**\\n\\n- service: api",
  "urgent": false
}
\`\`\`

- \`text\`：必填，1–4000 字符；原样传给微信。已实测支持标题、粗体、斜体、粗斜体、删除线、引用、列表、任务列表、链接、表格、分隔线、行内代码和 fenced code block。
- \`urgent\`：可选，默认 \`false\`。\`true\` 立即发送；\`false\` 在用户静默时段内排队，结束后合并发送。

## 发送图片通知

\`POST /api/v1/notify/image\`

请求必须是 \`multipart/form-data\`：

\`\`\`bash
curl -X POST "${origin}/api/v1/notify/image" \\
  -H "Authorization: Bearer $WX_NOTIFY_API_KEY" \\
  -H "Idempotency-Key: monitor:screenshot:42" \\
  -F "image=@./screenshot.webp" \\
  -F "urgent=true"
\`\`\`

- \`image\`：必填，JPEG、PNG 或 WebP；按文件签名识别，最大 20 MiB。
- SVG：明确不支持，返回 HTTP 415。
- \`urgent\`：可选字符串 \`true\` / \`false\`，默认 \`false\`。
- 静默时段内的非紧急图片临时保存到 R2；发送成功后删除。

## 幂等

\`Idempotency-Key\` 可选，最长 128 字符。它由调用方为一个业务事件指定，例如 \`crm:lead:8392\`。重试同一事件时复用相同值；省略时重试可能产生重复通知。

瞬时 iLink/CDN 网络错误最多自动尝试 3 次。静默时段队列失败后按指数退避再次投递，连续失败 12 次后标记为最终失败；重试始终复用同一幂等标识。

## 响应

- HTTP 200：已发送。
- HTTP 202：已进入静默时段队列，响应包含 \`scheduled_for\`。
- HTTP 409：相同幂等键对应的延迟通知已达到最终失败状态。
- HTTP 401：API Key 无效。
- HTTP 413：图片超过 20 MiB。
- HTTP 415：请求格式或图片格式不支持。
- HTTP 502：腾讯 iLink/CDN 拒绝该图片。
- HTTP 503：微信未绑定、需要发送 \`init\` 刷新会话，或需要重新扫码。`;
}

const dashboardScript = `
const $=s=>document.querySelector(s),status=(id,text,ok=false)=>{const e=$(id);e.textContent=text;e.className='status '+(ok?'ok':'')};
async function json(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({error:'请求失败'}));if(!r.ok)throw new Error(d.message||d.error||'HTTP '+r.status);return d}
async function loadKey(){const d=await json('/api/api-key');$('#apiKey').value=d.api_key||'';$('#keyStatus').textContent=d.api_key?'当前 API Key 可随时复制。':'尚未生成 API Key。'}
$('#copyKey').onclick=()=>navigator.clipboard.writeText($('#apiKey').value);$('#rotateKey').onclick=async()=>{if($('#apiKey').value&&!confirm('Rotate 后旧 Key 会立即失效，继续吗？'))return;const d=await json('/api/api-key',{method:'POST'});$('#apiKey').value=d.api_key;status('#keyStatus','已生成并保存。以后仍可在这里查看和复制。',true)};loadKey();
$('#saveQuiet').onclick=async()=>{const d=await json('/api/settings',{method:'PUT',body:JSON.stringify({quietStart:$('#quietStart').value,quietEnd:$('#quietEnd').value,phone:$('#phone').value})});status('#settingsStatus','设置已保存',true)};
$('#changePassword').onclick=async()=>{try{await json('/api/password',{method:'POST',body:JSON.stringify({currentPassword:$('#currentPassword').value,newPassword:$('#newPassword').value})});status('#passwordStatus','密码已修改，其他会话已退出。',true)}catch(e){status('#passwordStatus',e.message)}};
let loginSession=null,stop=false;async function loginLoop(code){if(stop||!loginSession)return;try{const d=await json('/api/wechat/login/status',{method:'POST',body:JSON.stringify({session:loginSession,verifyCode:code||undefined})});loginSession=d.session||loginSession;if(d.status==='need_verifycode'){$('#verify').classList.remove('hidden');status('#wechatStatus','请输入微信显示的数字验证码');return}if(d.status==='confirmed'){status('#wechatStatus','绑定成功。请在微信中给 Bot 发送 init；后台将在一分钟内变为 Ready。',true);return}if(['expired','verify_code_blocked'].includes(d.status)){status('#wechatStatus',d.message||'二维码已失效');return}status('#wechatStatus',d.status==='scaned'?'已扫码，等待手机确认…':'等待扫码…');loginLoop()}catch(e){status('#wechatStatus',e.message)}}
const bindBtn=$('#bindWechat');if(bindBtn)bindBtn.onclick=async()=>{stop=false;const d=await json('/api/wechat/login/start',{method:'POST'});loginSession=d.session;$('#qr').innerHTML=d.qr_svg;status('#wechatStatus','请使用微信扫码');loginLoop()};$('#submitCode').onclick=()=>{$('#verify').classList.add('hidden');loginLoop($('#verifyCode').value)};
$('#copyDocs').onclick=()=>navigator.clipboard.writeText($('#apiDocs').value);$('#logout').onclick=async()=>{await fetch('/api/auth/sign-out',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});location.href='/login'};
const inviteBtn=$('#createInvite');if(inviteBtn)inviteBtn.onclick=async()=>{try{const d=await json('/api/admin/invitations',{method:'POST',body:JSON.stringify({email:$('#inviteEmail').value||null})});$('#inviteResult').value=d.url;status('#inviteStatus','邀请码已创建，链接只在本次响应展示。',true)}catch(e){status('#inviteStatus',e.message)}};`;

export function dashboardPage(props: DashboardProps) {
  const docs = apiMarkdown(props.origin);
  const needsQr = props.bindingStatus === null || props.bindingStatus === "reauth_required";
  const bindingMessage = props.bindingStatus === "active"
    ? "绑定正常，可以接收通知。"
    : props.bindingStatus === "pending_context"
      ? "请在微信中给 Bot 发送 init；系统将在一分钟内完成初始化。"
      : props.bindingStatus === "reauth_required"
        ? "微信授权已失效，请重新扫码绑定。"
        : "尚未绑定微信，请扫码绑定。";
  const bindingMessageClass = props.bindingStatus === "active" ? "status ok" : props.bindingStatus === "reauth_required" ? "status error" : "status";
  return <Layout title="微信通知 Gateway" script={dashboardScript}><main class="shell"><header><div><div class="brand">微信通知 Gateway</div><div class="muted">{props.email}</div></div><nav><span class="pill">{props.role}</span><button id="logout" class="secondary">退出</button></nav></header>
    <div class="grid">
      <section class="card"><h2>微信绑定</h2><p class="muted">每个用户只能绑定一个微信 ClawBot。当前状态：<code>{props.bindingStatus ?? "未绑定"}</code></p>{needsQr ? <button id="bindWechat">{props.bindingStatus === "reauth_required" ? "重新扫码绑定" : "扫码绑定"}</button> : null}<div id="qr"></div><div id="verify" class="hidden"><label>数字验证码</label><div class="row"><input id="verifyCode" inputmode="numeric"/><button id="submitCode">提交</button></div></div><div id="wechatStatus" class={bindingMessageClass}>{bindingMessage}</div></section>
      <section class="card"><h2>API Key</h2><p class="muted">Key 经加密保存，因此登录后可随时查看和复制。Rotate 会立即作废旧 Key。</p><label>当前 API Key</label><div class="row"><input id="apiKey" class="key" readonly/><button id="copyKey">复制</button></div><button id="rotateKey" class="danger">生成 / Rotate</button><div id="keyStatus" class="status"></div></section>
      <section class="card"><h2>通知设置</h2><p class="muted">UTC+8。静默时段只发送紧急通知，普通通知在结束后合并发送；开始和结束相同表示关闭静默。</p><div class="row"><div><label>开始</label><input id="quietStart" type="time" value={minutesToTime(props.quietStart)}/></div><div><label>结束</label><input id="quietEnd" type="time" value={minutesToTime(props.quietEnd)}/></div></div><label>中国大陆手机号（可选）</label><input id="phone" value={props.phone ?? ""} inputmode="tel"/><button id="saveQuiet">保存设置</button><div id="settingsStatus" class="status hidden"></div></section>
      <section class="card"><h2>修改密码</h2><label>当前密码</label><input id="currentPassword" type="password" autocomplete="off"/><label>新密码</label><input id="newPassword" type="password" minlength={12} maxlength={128} autocomplete="off"/><button id="changePassword">修改并退出其他会话</button><div id="passwordStatus" class="status hidden"></div></section>
      <section class="card" style="grid-column:1/-1"><h2>API 文档</h2><p class="muted">Base URL 按当前 Host 自动生成。</p><textarea id="apiDocs" class="key" readonly>{docs}</textarea><button id="copyDocs">复制 Markdown</button></section>
      {props.role === "admin" ? <section class="card"><h2>管理员：创建邀请码</h2><label>限制邮箱（可选）</label><input id="inviteEmail" type="email" autocomplete="off"/><button id="createInvite">创建 7 天有效邀请码</button><label>注册链接</label><div class="row"><input id="inviteResult" readonly autocomplete="off"/><button onclick={html`navigator.clipboard.writeText(document.querySelector('#inviteResult').value)`}>复制</button></div><div id="inviteStatus" class="status hidden"></div></section> : null}
    </div></main></Layout>;
}
