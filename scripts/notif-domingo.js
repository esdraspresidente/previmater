const https = require('https');

const SB_URL = 'https://ggyngtqknonwnohbzkyj.supabase.co';
const SB_KEY = 'sb_publishable_WJOo1uEpdSXTPoPDlErTJw_vPSe5x1S';
const RESEND_KEY = process.env.RESEND_KEY;
const DEST = 'esdraspresidente@gmail.com';
const CRM = 'https://esdraspresidente.github.io/previmater-crm';

// Teto por consulta. O PostgREST corta em 1000 linhas sem avisar; pedindo 500
// e comparando com o que voltou, o e-mail consegue dizer que a lista veio
// cortada em vez de mostrar um total errado com cara de completo.
const TETO = 500;

function fDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function fBRL(v) {
  return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}
// Segunda-feira da semana corrente. O e-mail sai domingo, mas o workflow
// tambem roda no botao — sem isso, disparar numa quarta produziria uma
// "semana" comecando na quinta anterior e o resumo nao bateria com nada.
function segundaDaSemana(dataStr) {
  const d = new Date(dataStr + 'T12:00:00Z');
  const dow = d.getUTCDay();
  return addDays(dataStr, dow === 0 ? -6 : 1 - dow);
}
function primeiroDiaDoMes(dataStr) {
  return dataStr.slice(0, 8) + '01';
}
function ultimoDiaDoMes(dataStr) {
  const [y, m] = dataStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
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

async function buscar(filtros, ordem) {
  const url = SB_URL + '/rest/v1/pm_parcelas?select=*,pm_clientes(whatsapp,trello_url)'
    + filtros + '&order=' + ordem + '&limit=' + TETO;
  const r = await req(url, { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
  const lista = r.json();
  return Array.isArray(lista) ? lista : [];
}

function linhaHtml(p, corBorda) {
  const cli = p.pm_clientes || {};
  const wa = cli.whatsapp ? 'https://wa.me/55' + cli.whatsapp.replace(/\D/g, '') : null;
  const letra = (p.cliente_nome || '?').charAt(0).toUpperCase();
  const dataRef = p.data_pagamento || p.data_vencimento;
  const recebe = p.valor_cliente && parseFloat(p.valor_cliente) > 0
    ? '<div style="font-size:12px;color:#0A7A5C;font-weight:600;margin-bottom:4px">Cliente recebe: ' + fBRL(p.valor_cliente) + '</div>'
    : '';
  const btn = wa
    ? '<a href="' + wa + '" style="display:inline-block;background:#E0F5EE;color:#0A7A5C;padding:4px 11px;border-radius:20px;text-decoration:none;font-size:12px;font-weight:700">&#x1F4AC; WhatsApp</a>'
    : '';
  return '<div style="background:#fff;border:2px solid ' + corBorda + ';border-radius:12px;padding:13px;margin-bottom:9px">'
    + '<div style="display:flex;align-items:center;gap:12px">'
    + '<div style="width:38px;height:38px;border-radius:50%;background:#0A9396;color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0">' + letra + '</div>'
    + '<div style="flex:1;min-width:0">'
    + '<div style="font-size:14px;font-weight:700;color:#0D2B2B;margin-bottom:2px">' + p.cliente_nome + '</div>'
    + '<div style="font-size:12px;color:#7FA8A8;margin-bottom:5px">Parcela ' + p.num_parcela + '/' + p.total_parcelas + ' &middot; ' + fDate(dataRef) + '</div>'
    + recebe + btn
    + '</div>'
    + '<div style="text-align:right;flex-shrink:0"><div style="font-size:17px;font-weight:800;color:#0D2B2B">' + fBRL(p.valor_honorario) + '</div></div>'
    + '</div></div>';
}

function secaoHtml(titulo, lista, corBorda, vazio) {
  const total = lista.reduce((s, p) => s + parseFloat(p.valor_honorario || 0), 0);
  const aviso = lista.length >= TETO
    ? '<div style="font-size:11px;color:#B06000;margin-bottom:8px">Lista cortada em ' + TETO + ' itens — o total abaixo esta incompleto.</div>'
    : '';
  const corpo = lista.length
    ? aviso + lista.map(p => linhaHtml(p, corBorda)).join('')
    : '<div style="font-size:13px;color:#7FA8A8;padding:6px 0">' + vazio + '</div>';
  return '<div style="background:#fff;border:1px solid #D4EBEB;border-radius:14px;padding:18px;margin-bottom:16px">'
    + '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px">'
    + '<div style="font-size:14px;font-weight:700;color:#0D2B2B">' + titulo + '</div>'
    + '<div style="font-size:15px;font-weight:800;color:#0D2B2B">' + (lista.length ? fBRL(total) : '') + '</div>'
    + '</div>' + corpo + '</div>';
}

function emailHtml(subtitulo, destaqueLabel, destaqueValor, secoes) {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>'
    + '<body style="margin:0;padding:0;background:#EFF7F7;font-family:Arial,sans-serif">'
    + '<div style="max-width:600px;margin:0 auto;padding:24px 16px">'
    + '<div style="background:linear-gradient(135deg,#0A9396,#00B4D8);border-radius:16px;padding:24px;margin-bottom:20px;text-align:center">'
    + '<div style="font-size:20px;font-weight:800;color:#fff">&#9878; PreviMater</div>'
    + '<div style="font-size:13px;color:rgba(255,255,255,.85);margin-top:4px">' + subtitulo + '</div>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #D4EBEB;border-radius:14px;padding:20px;margin-bottom:20px;text-align:center">'
    + '<div style="font-size:12px;font-weight:700;color:#7FA8A8;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">' + destaqueLabel + '</div>'
    + '<div style="font-size:32px;font-weight:800;color:#0A9396;letter-spacing:-.5px">' + destaqueValor + '</div>'
    + '</div>'
    + secoes
    + '<div style="text-align:center;padding:16px">'
    + '<a href="' + CRM + '" style="display:inline-block;background:linear-gradient(135deg,#0A9396,#00B4D8);color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Abrir o CRM &rarr;</a>'
    + '<div style="font-size:11px;color:#7FA8A8;margin-top:12px">PreviMater CRM &middot; Resumo semanal</div>'
    + '</div></div></body></html>';
}

async function enviaEmail(subject, html) {
  const body = JSON.stringify({
    from: 'PreviMater <onboarding@resend.dev>',
    to: [DEST],
    subject: subject,
    html: html
  });
  const r = await req('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
    body: body
  });
  const result = r.json();
  if (r.ok) console.log('Email enviado:', subject, result.id);
  else { console.error('Erro Resend:', result); process.exit(1); }
}

async function main() {
  const hoje = today();
  const segAtual = segundaDaSemana(hoje);
  const domAtual = addDays(segAtual, 6);
  const segProx = addDays(segAtual, 7);
  const domProx = addDays(segAtual, 13);
  const mesIni = primeiroDiaDoMes(hoje);
  const mesFim = ultimoDiaDoMes(hoje);

  const [recebidas, proxima, atrasadas, inadimplentes] = await Promise.all([
    // Recebido na semana ancora em data_pagamento, que e quando o dinheiro
    // entrou de fato — nao em data_vencimento, que e so a promessa.
    buscar('&status=eq.recebido&data_pagamento=gte.' + segAtual + '&data_pagamento=lte.' + domAtual, 'data_pagamento.asc'),
    buscar('&status=eq.previsto&data_vencimento=gte.' + segProx + '&data_vencimento=lte.' + domProx, 'data_vencimento.asc'),
    // Atrasado nao e status gravado, e conta: previsto com vencimento no passado.
    buscar('&status=eq.previsto&data_vencimento=lt.' + hoje, 'data_vencimento.asc'),
    buscar('&status=eq.inadimplente&data_vencimento=gte.' + mesIni + '&data_vencimento=lte.' + mesFim, 'data_vencimento.asc')
  ]);

  const totalRecebido = recebidas.reduce((s, p) => s + parseFloat(p.valor_honorario || 0), 0);

  console.log('Semana', segAtual, 'a', domAtual);
  console.log('recebidas', recebidas.length, '| proxima', proxima.length,
              '| atrasadas', atrasadas.length, '| inadimplentes', inadimplentes.length);

  const secoes =
      secaoHtml('&#x1F4B0; Recebido nesta semana', recebidas, '#0A9396', 'Nenhum recebimento registrado nesta semana.')
    + secaoHtml('&#x1F4C5; A receber na proxima semana', proxima, '#D4EBEB', 'Nenhuma parcela vence na proxima semana.')
    + secaoHtml('&#9888; Atrasadas acumuladas', atrasadas, '#F0C8C2', 'Nenhuma parcela em atraso.')
    + secaoHtml('&#9873; Inadimplentes do mes', inadimplentes, '#F0C8C2', 'Nenhuma inadimplencia marcada neste mes.');

  const html = emailHtml(
    'Semana de ' + fDate(segAtual) + ' a ' + fDate(domAtual),
    'Recebido na semana',
    fBRL(totalRecebido),
    secoes
  );

  // Sai todo domingo mesmo com semana zerada: um resumo que so aparece quando
  // entrou dinheiro faz o silencio parecer normal, e semana sem recebimento e
  // justamente a que precisa ser vista.
  await enviaEmail('📊 PreviMater — Semana ' + fDate(segAtual) + ' a ' + fDate(domAtual) + ' · ' + fBRL(totalRecebido), html);
}

main().catch(e => { console.error(e); process.exit(1); });
