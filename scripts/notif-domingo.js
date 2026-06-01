const https = require('https');

const SB_URL = 'https://ggyngtqknonwnohbzkyj.supabase.co';
const SB_KEY = 'sb_publishable_WJOo1uEpdSXTPoPDlErTJw_vPSe5x1S';
const RESEND_KEY = process.env.RESEND_KEY;
const DEST = 'esdraspresidente@gmail.com';

function fDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function fBRL(v) {
  return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

function req(url, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ ok: res.statusCode < 300, status: res.statusCode, json: () => JSON.parse(data) }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function cardHtml(p) {
  const cli = p.pm_clientes || {};
  const wa = cli.whatsapp ? 'https://wa.me/55' + cli.whatsapp.replace(/\D/g, '') : null;
  const tr = cli.trello_url || null;
  const letra = (p.cliente_nome || '?').charAt(0).toUpperCase();
  const btns = [
    wa ? '<a href="' + wa + '" style="display:inline-flex;align-items:center;gap:5px;background:#E0F5EE;color:#0A7A5C;padding:5px 12px;border-radius:20px;text-decoration:none;font-size:12px;font-weight:700">&#x1F4AC; WhatsApp</a>' : '',
    tr ? '<a href="' + tr + '" style="display:inline-flex;align-items:center;gap:5px;background:#EDF2FC;color:#1D4ED8;padding:5px 12px;border-radius:20px;text-decoration:none;font-size:12px;font-weight:700">&#x1F4CB; Trello</a>' : ''
  ].filter(Boolean).join(' ');
  return '<div style="background:#fff;border:1px solid #D4EBEB;border-radius:12px;padding:14px;margin-bottom:8px">'
    + '<div style="display:flex;align-items:center;gap:12px">'
    + '<div style="width:40px;height:40px;border-radius:50%;background:#0A9396;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0">' + letra + '</div>'
    + '<div style="flex:1;min-width:0">'
    + '<div style="font-size:14px;font-weight:700;color:#0D2B2B;margin-bottom:2px">' + p.cliente_nome + '</div>'
    + '<div style="font-size:11px;color:#7FA8A8;margin-bottom:6px">Parcela ' + p.num_parcela + '/' + p.total_parcelas + ' &middot; ' + fDate(p.data_vencimento) + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">' + btns + '</div>'
    + '</div>'
    + '<div style="text-align:right;flex-shrink:0;font-size:17px;font-weight:800;color:#0D2B2B">' + fBRL(p.valor_honorario) + '</div>'
    + '</div></div>';
}

async function main() {
  const inicio = today();
  const fim = addDays(inicio, 6);

  const url = SB_URL + '/rest/v1/pm_parcelas?select=*,pm_clientes(whatsapp,trello_url)'
    + '&data_vencimento=gte.' + inicio
    + '&data_vencimento=lte.' + fim
    + '&status=neq.cancelado&status=neq.recebido&order=data_vencimento.asc';

  const r = await req(url, { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  const parcelas = r.json();

  console.log('Parcelas na semana:', parcelas.length);

  if (!parcelas.length) {
    console.log('Nenhuma parcela esta semana, email não enviado.');
    return;
  }

  const totalSemana = parcelas.reduce((s, p) => s + parseFloat(p.valor_honorario || 0), 0);

  // Agrupa por data
  const porData = {};
  for (const p of parcelas) {
    if (!porData[p.data_vencimento]) porData[p.data_vencimento] = [];
    porData[p.data_vencimento].push(p);
  }

  let cardsHtml = '';
  for (const data of Object.keys(porData).sort()) {
    const d = new Date(data + 'T12:00:00Z');
    const diasSemana = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const nomeDia = diasSemana[d.getUTCDay()];
    const totalDia = porData[data].reduce((s, p) => s + parseFloat(p.valor_honorario || 0), 0);
    cardsHtml += '<div style="margin-bottom:20px">'
      + '<div style="font-size:12px;font-weight:700;color:#0A9396;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #E0F4F5">'
      + nomeDia + ' ' + fDate(data) + ' &middot; ' + fBRL(totalDia)
      + '</div>'
      + porData[data].map(p => cardHtml(p)).join('')
      + '</div>';
  }

  const html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>'
    + '<body style="margin:0;padding:0;background:#EFF7F7;font-family:Arial,sans-serif">'
    + '<div style="max-width:600px;margin:0 auto;padding:24px 16px">'
    + '<div style="background:linear-gradient(135deg,#0A9396,#00B4D8);border-radius:16px;padding:24px;margin-bottom:20px;text-align:center">'
    + '<div style="font-size:20px;font-weight:800;color:#fff">&#9878; PreviMater</div>'
    + '<div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:4px">Resumo da Semana</div>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #D4EBEB;border-radius:14px;padding:20px;margin-bottom:20px;text-align:center">'
    + '<div style="font-size:12px;font-weight:700;color:#7FA8A8;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Total Previsto na Semana</div>'
    + '<div style="font-size:32px;font-weight:800;color:#0A9396;letter-spacing:-.5px">' + fBRL(totalSemana) + '</div>'
    + '<div style="font-size:13px;color:#7FA8A8;margin-top:6px">' + parcelas.length + ' parcela' + (parcelas.length > 1 ? 's' : '') + ' &middot; ' + fDate(inicio) + ' a ' + fDate(fim) + '</div>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #D4EBEB;border-radius:14px;padding:20px;margin-bottom:20px">'
    + '<div style="font-size:14px;font-weight:700;color:#0D2B2B;margin-bottom:16px">&#x1F4C5; Parcelas da Semana</div>'
    + cardsHtml
    + '</div>'
    + '<div style="text-align:center;padding:16px">'
    + '<a href="https://esdraspresidente.github.io/previmater" style="display:inline-block;background:linear-gradient(135deg,#0A9396,#00B4D8);color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Abrir PreviMater &rarr;</a>'
    + '<div style="font-size:11px;color:#7FA8A8;margin-top:12px">PreviMater &middot; Gestão de Recebimentos</div>'
    + '</div></div></body></html>';

  const body = JSON.stringify({
    from: 'PreviMater <onboarding@resend.dev>',
    to: [DEST],
    subject: '&#x1F4C5; PreviMater — Semana de ' + fDate(inicio) + ' a ' + fDate(fim) + ' · ' + fBRL(totalSemana),
    html: html
  });

  const re = await req('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: body
  });
  const result = re.json();
  if (re.ok) console.log('Email enviado!', result.id);
  else { console.error('Erro Resend:', result); process.exit(1); }
}

main().catch(e => { console.error(e); process.exit(1); });
