/* Panel del administrador — Festival de la Voz Ministerial */
(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  let token = null; try { token = localStorage.getItem('fv_admin_token'); } catch {}
  let A = null, socket = null;
  let editing = null, photoData = null, removePhotoFlag = false, audioFile = null, removeAudioFlag = false, genero = '';
  let presetMin = { v: 5, j: 30 };
  let commentFilter = 'all', auditAll = null;
  const G = { F: 'Voz Femenina', M: 'Voz Masculina' };
  const placeName = { 1: '1.er lugar', 2: '2.º lugar', 3: '3.er lugar' };

  /* ================= utilidades ================= */
  async function api(path, body, method) {
    const r = await fetch('/api/admin' + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'x-admin-token': token || '' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { logout(); throw new Error('Sesión expirada'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { FV.toast(j.error || 'Error', 'error'); throw new Error(j.error); }
    return j;
  }
  // subida de archivos grandes con barra de progreso
  function upload(path, file, bar, method = 'PUT') {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, '/api/admin' + path);
      x.setRequestHeader('x-admin-token', token);
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      if (bar) { bar.hidden = false; bar.querySelector('i').style.width = '0%'; bar.querySelector('span').textContent = 'Subiendo… 0%'; }
      x.upload.onprogress = (e) => { if (bar && e.lengthComputable) { const p = Math.round((e.loaded / e.total) * 100); bar.querySelector('i').style.width = p + '%'; bar.querySelector('span').textContent = `Subiendo… ${p}%`; } };
      x.onload = () => {
        if (bar) bar.hidden = true;
        let j = {}; try { j = JSON.parse(x.responseText); } catch {}
        if (x.status >= 200 && x.status < 300) resolve(j); else { FV.toast(j.error || 'Error al subir el archivo', 'error'); reject(new Error(j.error)); }
      };
      x.onerror = () => { if (bar) bar.hidden = true; FV.toast('Error de conexión al subir', 'error'); reject(new Error('net')); };
      x.send(file);
    });
  }
  const confirmBox = (t, m, yes = 'Confirmar') => new Promise((res) => {
    $('#askT').textContent = t; $('#askM').innerHTML = m; $('#askYes').textContent = yes; $('#ask').classList.add('show');
    const done = (v) => { $('#ask').classList.remove('show'); $('#askYes').onclick = $('#askNo').onclick = null; res(v); };
    $('#askYes').onclick = () => done(true); $('#askNo').onclick = () => done(false);
  });
  const fmtDate = (ms) => new Date(ms).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' });
  const toLocalInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const statusName = { idle: 'EN ESPERA', scheduled: 'PROGRAMADA', open: 'ABIERTA', closed: 'CERRADA' };
  const pill = (st) => `<span class="pill ${st}"><i></i>${statusName[st]}</span>`;
  const minLabel = (m) => (m >= 60 ? `${m / 60} h` : `${m} min`);
  const download = async (path, name) => {
    const r = await fetch('/api/admin' + path, { headers: { 'x-admin-token': token } });
    const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
  };

  /* ================= sesión ================= */
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
    const j = await r.json();
    if (!r.ok) return FV.toast(j.error || 'Error', 'error');
    token = j.token; try { localStorage.setItem('fv_admin_token', token); } catch {}
    start();
  };
  function logout() {
    if (token) fetch('/api/admin/logout', { method: 'POST', headers: { 'x-admin-token': token } }).catch(() => {});
    try { localStorage.removeItem('fv_admin_token'); } catch {}
    token = null; socket && socket.disconnect(); $('#app').hidden = true; $('#login').hidden = false;
  }
  $('#logout').onclick = logout;
  function start() {
    $('#login').hidden = true; $('#app').hidden = false;
    socket = io({ auth: { role: 'admin', token } });
    socket.on('admin', (a) => { FV.syncClock(a.now); A = a; renderAll(); });
    socket.on('results', (r) => { if (!A) return; A.results = r.results; renderResults(); });
    socket.on('jury-admin', (j) => { if (!A) return; A.jury = j; renderJury(); renderJuryMini(); renderAwards(); });
    socket.on('community', (c) => { if (!A) return; A.community = c; renderCommunity(); });
    socket.on('likes', (m) => { if (!A) return; A.participants.forEach((p) => { if (m[p.id]) { p.likes = m[p.id].l; p.comments = m[p.id].c; } }); renderLikes(); });
    socket.on('audit', (e) => { if (!A) return; A.audit.unshift(e); if (auditAll) auditAll.unshift(e); renderAudit(); });
    socket.on('connect_error', () => FV.toast('Reconectando…'));
  }
  if (token) start();

  $('#tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'historial') loadAudit();
  };

  /* ================= render general ================= */
  const screenLink = () => `${location.origin}/pantalla?k=${A.settings.screenKey}`;
  const votingUrl = () => A.settings.publicUrl || location.origin + '/';
  function renderAll() {
    if (!A) return;
    $('#hTitle').textContent = `${A.settings.title} ${A.settings.year}`;
    $('#openScreen').href = screenLink();
    renderVoting(); renderScreen(); renderAwards(); renderResults(); renderParticipants(); renderJury(); renderJuryMini(); renderCommunity(); renderLikes(); renderSettings(); renderAudit();
  }

  /* ================= controles de tiempo (reutilizables) ================= */
  const PRESETS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 360, 720];
  function timeCtrls(k, closed, actStart, actReopen, extra = '') {
    return `<label>${closed ? 'Reabrir por (quienes ya participaron no pueden repetir)' : 'Duración'}</label>
      <div class="presets" data-k="${k}">${PRESETS.map((m) => `<button data-min="${m}" class="${m === presetMin[k] ? 'on' : ''}">${minLabel(m)}</button>`).join('')}
      ${closed ? '' : `<button data-min="0" class="unl ${presetMin[k] === 0 ? 'on' : ''}">∞ Sin límite</button>`}</div>
      <div class="row"><input type="number" class="customMin" data-k="${k}" min="1" max="720" value="${presetMin[k] || ''}" placeholder="min" style="width:100px"><span class="muted small">minutos (1 a 720)</span>
      <button class="btn ok grow" data-act="${closed ? actReopen : actStart}">▶ ${closed ? 'Reabrir' : 'Iniciar ahora'}</button></div>${extra}`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.presets button'); if (!b) return;
    const k = b.closest('.presets').dataset.k;
    presetMin[k] = +b.dataset.min;
    b.closest('.presets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const inp = document.querySelector(`.customMin[data-k="${k}"]`); if (inp) inp.value = presetMin[k] || '';
  });
  document.addEventListener('input', (e) => {
    if (!e.target.classList.contains('customMin')) return;
    const k = e.target.dataset.k; presetMin[k] = Math.max(1, Math.min(720, +e.target.value || 1));
    document.querySelectorAll(`.presets[data-k="${k}"] button`).forEach((x) => x.classList.toggle('on', +x.dataset.min === presetMin[k]));
  });
  const windowBody = (k) => (presetMin[k] === 0 ? { unlimited: true } : { minutes: presetMin[k] });
  const windowText = (k) => (presetMin[k] === 0 ? '<b>sin límite de tiempo</b> (hasta que usted la cierre)' : `durante <b>${minLabel(presetMin[k])}</b>`);

  /* ================= Voz de la Audiencia: control ================= */
  function renderVoting() {
    const v = A.votingFull;
    $('#statusPill').innerHTML = pill(v.status);
    const info = $('#votingInfo'), c = $('#votingCtrls');
    if (v.status === 'open') {
      info.innerHTML = v.endsAt ? `<div class="bigclock gold-text" data-clock="${v.endsAt}">--:--</div><div class="muted small">Cierra automáticamente: ${fmtDate(v.endsAt)}</div>` : `<div class="bigclock gold-text">∞</div><div class="muted small">Abierta sin límite de tiempo: ciérrela cuando desee.</div>`;
      c.innerHTML = `<hr class="sep"><div class="row"><button class="btn danger" data-act="vStop">■ Cerrar votación</button>${v.endsAt ? '<button class="btn ghost sm" data-ext="1">+1 min</button><button class="btn ghost sm" data-ext="5">+5 min</button><button class="btn ghost sm" data-ext="15">+15 min</button>' : ''}</div>`;
    } else if (v.status === 'scheduled') {
      info.innerHTML = `<div class="bigclock gold-text" data-clock="${v.startsAt}">--:--</div><div class="muted small">Abrirá: ${fmtDate(v.startsAt)} · Cerrará: ${fmtDate(v.endsAt)}</div>`;
      c.innerHTML = `<hr class="sep"><button class="btn danger sm" data-act="vStop">Cancelar programación</button>`;
    } else {
      const closed = v.status === 'closed';
      info.innerHTML = `<p class="muted small" style="margin:6px 0 0">${closed ? `Finalizó: ${fmtDate(v.endsAt)}. Puede revelar a la <b>Voz de la Audiencia</b> en la pantalla.` : 'El público ve a los participantes y escucha sus voces, pero <b>no</b> el botón de votar hasta que usted abra la votación.'}</p>`;
      c.innerHTML = `<hr class="sep">` + timeCtrls('v', closed, 'vStart', 'vReopen', closed ? '' : `<hr class="sep"><label>…o programar inicio y cierre (máx. 12 h)</label>
        <div class="row"><div class="grow"><span class="muted small">Inicio</span><input type="datetime-local" id="schS" value="${toLocalInput(Date.now() + 10 * 60000)}"></div>
        <div class="grow"><span class="muted small">Cierre</span><input type="datetime-local" id="schE" value="${toLocalInput(Date.now() + 25 * 60000)}"></div>
        <button class="btn blue sm" data-act="vSchedule" style="align-self:flex-end">Programar</button></div>`);
    }
  }
  $('#votingCtrls').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act], button[data-ext]'); if (!b) return;
    if (b.dataset.ext) return api('/voting/extend', { minutes: +b.dataset.ext }).then(() => FV.toast(`+${b.dataset.ext} min`, 'ok'));
    const act = b.dataset.act;
    if (act === 'vStart') { if (await confirmBox('Abrir la Voz de la Audiencia', `La votación del público se abrirá <b>ahora</b> ${windowText('v')}.`, 'Abrir')) api('/voting/start', windowBody('v')).then(() => FV.toast('¡Votación abierta!', 'ok')); }
    else if (act === 'vReopen') api('/voting/extend', { minutes: presetMin.v || 5 }).then(() => FV.toast('Votación reabierta', 'ok'));
    else if (act === 'vSchedule') api('/voting/start', { startsAt: new Date($('#schS').value).getTime(), endsAt: new Date($('#schE').value).getTime() }).then(() => FV.toast('Votación programada', 'ok'));
    else if (act === 'vStop') { if (await confirmBox('Cerrar votación', 'El público ya no podrá votar.', 'Cerrar')) api('/voting/stop', {}); }
  });

  setInterval(() => {
    $$('[data-clock]').forEach((el) => (el.textContent = FV.fmtTime(+el.dataset.clock - FV.now())));
  }, 250);

  /* ================= pantalla de gala ================= */
  function renderScreen() {
    $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === A.screen.mode));
    $('#showCounts').checked = !!A.screen.showCounts;
    $('#replay').hidden = !['ganador', 'podio', 'premiacion', 'homenaje'].includes(A.screen.mode);
  }
  $('#modes').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const m = b.dataset.mode;
    if ((m === 'ganador' || m === 'podio') && A.votingFull.status === 'open' && !(await confirmBox('La votación sigue abierta', '¿Mostrar el resultado del público antes de cerrar la votación?', 'Mostrar'))) return;
    if (m === 'video' && !A.settings.video) return FV.toast('Primero suba un video en «Página y QR».', 'error');
    if (m === 'homenaje' && !A.participantsFull.some((p) => p.tribute)) return FV.toast('No hay participantes marcados como homenaje póstumo.', 'error');
    api('/screen', { mode: m });
  };
  $('#replay').onclick = () => (A.screen.mode === 'premiacion' ? api('/screen', { awardStep: A.screen.awardStep }) : api('/screen', { mode: A.screen.mode }));
  $('#showCounts').onchange = (e) => api('/screen', { showCounts: e.target.checked });

  function renderAwards() {
    if (!A) return;
    const R = A.jury.results;
    $$('#awards button').forEach((b) => b.classList.toggle('on', A.screen.mode === 'premiacion' && +b.dataset.step === A.screen.awardStep));
    const n = R.winners.F.length + R.winners.M.length;
    $('#awardNote').innerHTML = !R.deliberation ? 'Disponible cuando el jurado termine de evaluar.'
      : !R.allResolved ? '⚠ Hay empates pendientes de resolver.'
      : R.allApproved ? `✓ Resultados certificados por los ${A.jury.judges.length} jurados. Revele del 3.er al 1.er lugar.`
      : `⚠ Aún no todos los jurados aprobaron (${R.approvedBy.length}/${A.jury.judges.length}). Puede mostrarlos igualmente.`;
    $$('#awards button').forEach((b) => (b.disabled = !n));
  }
  $('#awards').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const R = A.jury.results;
    if (!R.allApproved && !(await confirmBox('Resultados sin certificar', 'No todos los jurados han aprobado a los ganadores. ¿Mostrar de todas formas?', 'Mostrar'))) return;
    api('/screen', { mode: 'premiacion', awardStep: +b.dataset.step });
  };

  /* ================= Voz de la Audiencia: resultados ================= */
  function rankItem(p, i, max, full) {
    const adj = p.adjust ? `<div class="adj-note">${p.real} reales ${p.adjust > 0 ? '+' : ''}${p.adjust} ajuste</div>` : '';
    return `<div class="rk" data-id="${p.id}">
      <div class="pos">${i + 1}</div><div class="av">${FV.photoHtml(p)}</div>
      <div style="min-width:0"><div class="nm">${p.grado ? `<small>${FV.esc(p.grado)}</small>` : ''}${FV.esc(FV.fullName(p))}</div><div class="bar"><div style="width:${max ? (p.votes / max) * 100 : 0}%"></div></div></div>
      <div class="v">${p.votes}<small>${p.pct.toFixed(1)}%</small>${adj}</div>
      ${full ? `<div class="ctrl"><button class="neg" data-d="-10">−10</button><button class="neg" data-d="-1">−1</button><button data-d="1">+1</button><button data-d="10">+10</button>
        <input type="number" min="0" placeholder="Fijar" data-set><button data-setbtn>Fijar total</button>
        <span class="info">Reales: <b>${p.real}</b> · Ajuste: <b>${p.adjust > 0 ? '+' : ''}${p.adjust}</b></span></div>` : ''}
    </div>`;
  }
  function renderResults() {
    const r = A.results; const max = r.ranking[0]?.votes || 0;
    $('#kTotal').textContent = r.total; $('#kVoters').textContent = r.voters;
    $('#liveNote').textContent = r.total !== r.totalReal ? `— incluye ajustes (reales: ${r.totalReal})` : '';
    $('#miniRank').innerHTML = r.ranking.length ? r.ranking.slice(0, 10).map((p, i) => rankItem(p, i, max, false)).join('') : '<p class="muted">Agregue participantes para comenzar.</p>';
    const fr = $('#fullRank');
    if (!(fr.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) fr.innerHTML = r.ranking.map((p, i) => rankItem(p, i, max, true)).join('') || '<p class="muted">Sin participantes.</p>';
  }
  $('#fullRank').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('.rk').dataset.id;
    if (b.dataset.d) api('/adjust', { participantId: id, delta: +b.dataset.d });
    if (b.dataset.setbtn !== undefined) {
      const v = b.closest('.rk').querySelector('[data-set]').value;
      if (v === '') return FV.toast('Escriba el total de votos', 'error');
      api('/adjust', { participantId: id, set: +v }).then(() => FV.toast('Total actualizado', 'ok'));
    }
  });
  $('#clearAdj').onclick = async () => { if (await confirmBox('Quitar ajustes', 'Se volverá a los votos reales del público.', 'Quitar')) api('/adjust/clear', {}); };
  $('#csv').onclick = () => download('/export.csv', 'voz-de-la-audiencia-2026.csv');

  /* ================= participantes ================= */
  function renderParticipants() {
    const ps = A.participantsFull, n = ps.length;
    $('#pCount').textContent = `(${n}/${A.maxParticipants})`;
    $('#pLimit').textContent = n >= A.maxParticipants && !editing ? `Se alcanzó el máximo de ${A.maxParticipants}.` : `${n} de ${A.maxParticipants}`;
    $('#pSubmit').disabled = n >= A.maxParticipants && !editing;
    $('#plist').innerHTML = ps.map((p, i) => `<div class="pi ${p.tribute ? 'trib' : ''}" data-id="${p.id}">
      <div class="ph">${FV.photoHtml(p)}<span class="no">${p.number}</span>
        <div class="tags">${p.tribute ? '<span class="tag trib">🕯️ Homenaje</span>' : ''}${p.inEvaluation ? '<span class="tag eval">⚖️ En evaluación</span>' : ''}${!p.tribute && !p.genero ? '<span class="tag nog">Sin categoría</span>' : ''}${p.genero ? `<span class="chip-gender ${p.genero}">${G[p.genero]}</span>` : ''}</div></div>
      <div class="meta"><div class="g">${FV.esc(p.grado || '—')}</div><div class="n">${FV.esc(FV.fullName(p))}</div><div class="s">${p.cancion ? '♪ ' + FV.esc(p.cancion) : ''} ${p.audio ? '· 🎵 audio' : '· sin audio'}</div></div>
      <div class="acts">
        <button data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Mover antes">◀</button><button data-edit>Editar</button><button class="del" data-del>Eliminar</button><button data-mv="1" ${i === n - 1 ? 'disabled' : ''} title="Mover después">▶</button>
        ${p.tribute ? '' : `<button class="ev ${p.inEvaluation ? 'on' : ''}" data-ev>${p.inEvaluation ? '✓ En sala de evaluación' : '⚖️ Enviar a evaluación'}</button>`}
      </div></div>`).join('') || '<p class="muted">Aún no hay participantes. Agregue el primero arriba.</p>';
  }
  function setGenero(g) { genero = g; $$('#fGenero button').forEach((b) => b.classList.toggle('on', b.dataset.g === g)); }
  $('#fGenero').onclick = (e) => { const b = e.target.closest('button'); if (b) setGenero(b.dataset.g); };
  $('#fTribute').onchange = (e) => { if (e.target.checked) $('#fEval').checked = false; $('#fEval').disabled = e.target.checked; };
  function renderAudioState(url) {
    $('#audioState').innerHTML = audioFile ? `Nuevo: ${FV.esc(audioFile.name)} (${(audioFile.size / 1048576).toFixed(1)} MB)` : url && !removeAudioFlag ? FV.playerHtml(url, 'Voz') : 'Sin audio';
    $('#audioRemove').hidden = !(audioFile || (url && !removeAudioFlag));
  }
  function resetForm() {
    editing = null; photoData = null; removePhotoFlag = false; audioFile = null; removeAudioFlag = false;
    $('#pForm').reset(); setGenero(''); $('#fEval').disabled = false;
    $('#drop').innerHTML = '<span>📷<br>Toca o arrastra<br>la foto aquí</span>';
    $('#formTitle').textContent = 'Agregar participante'; $('#pSubmit').textContent = 'Agregar participante';
    $('#pCancel').hidden = true; $('#pRemovePhoto').hidden = true;
    renderAudioState(null);
    A && renderParticipants();
  }
  $('#pCancel').onclick = resetForm;
  $('#pRemovePhoto').onclick = () => { removePhotoFlag = true; photoData = null; $('#drop').innerHTML = '<span>Sin foto</span>'; $('#pRemovePhoto').hidden = true; };
  $('#audioPick').onclick = () => $('#audioFile').click();
  $('#audioFile').onchange = (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 15 * 1048576) return FV.toast('El audio supera 15 MB. Use un MP3 corto.', 'error');
    audioFile = f; removeAudioFlag = false;
    renderAudioState(null);
  };
  $('#audioRemove').onclick = () => { audioFile = null; removeAudioFlag = true; renderAudioState(null); };

  $('#plist').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.closest('.pi').dataset.id; const p = A.participantsFull.find((x) => x.id === id);
    if (b.dataset.mv) {
      const ids = A.participantsFull.map((x) => x.id); const i = ids.indexOf(id), j = i + +b.dataset.mv;
      [ids[i], ids[j]] = [ids[j], ids[i]]; api('/participants/reorder', { ids });
    } else if (b.dataset.ev !== undefined) {
      if (!p.inEvaluation && !p.genero) FV.toast('Recuerde asignar la categoría (Femenina/Masculina) a este participante.', 'error');
      api('/participants/' + id, { inEvaluation: !p.inEvaluation }, 'PUT');
    } else if (b.dataset.edit !== undefined) {
      editing = id; photoData = null; removePhotoFlag = false; audioFile = null; removeAudioFlag = false;
      $('#fGrado').value = p.grado; $('#fNombre').value = p.nombre; $('#fApellidos').value = p.apellidos;
      $('#fCancion').value = p.cancion || ''; $('#fDesc').value = p.descripcion || '';
      $('#fEval').checked = p.inEvaluation; $('#fTribute').checked = p.tribute; $('#fEval').disabled = p.tribute;
      setGenero(p.genero || '');
      $('#drop').innerHTML = p.photo ? `<img src="${FV.esc(p.photo)}" alt="">` : '<span>📷<br>Toca para<br>agregar foto</span>';
      renderAudioState(p.audio);
      $('#formTitle').textContent = `Editar: ${FV.fullName(p)}`; $('#pSubmit').textContent = 'Guardar cambios';
      $('#pCancel').hidden = false; $('#pRemovePhoto').hidden = !p.photo; $('#pSubmit').disabled = false;
      $('#tab-participantes').scrollIntoView({ behavior: 'smooth' });
    } else if (b.dataset.del !== undefined) {
      if (await confirmBox('Eliminar participante', `¿Eliminar a <b>${FV.esc(FV.fullName(p))}</b>? Se perderán sus votos, me gusta, comentarios y evaluaciones del jurado.`, 'Eliminar')) { api('/participants/' + id, null, 'DELETE'); if (editing === id) resetForm(); }
    }
  });
  $('#evalAll').onclick = () => api('/participants/evaluation', { inEvaluation: true }).then((r) => FV.toast(`${r.changed} participante(s) enviados a evaluación`, 'ok'));
  $('#evalNone').onclick = async () => { if (await confirmBox('Retirar de evaluación', 'Los jurados dejarán de ver a todos los participantes. Las puntuaciones ya guardadas se conservan.', 'Retirar')) api('/participants/evaluation', { inEvaluation: false }); };

  async function loadPhoto(file) {
    if (!file || !file.type.startsWith('image/')) return FV.toast('Seleccione una imagen', 'error');
    const url = URL.createObjectURL(file);
    const img = new Image(); img.src = url; await img.decode().catch(() => {});
    const max = 1000, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    photoData = c.toDataURL('image/jpeg', 0.87); removePhotoFlag = false;
    $('#drop').innerHTML = `<img src="${photoData}" alt="">`;
  }
  const drop = $('#drop');
  drop.onclick = () => $('#file').click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file').click(); } };
  $('#file').onchange = (e) => { loadPhoto(e.target.files[0]); e.target.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); loadPhoto(e.dataTransfer.files[0]); };

  $('#pForm').onsubmit = async (e) => {
    e.preventDefault();
    const tribute = $('#fTribute').checked;
    if (!genero && !tribute && !(await confirmBox('Sin categoría', 'No seleccionó <b>Voz Femenina</b> ni <b>Voz Masculina</b>. Sin categoría no podrá ganar en el jurado. ¿Guardar igualmente?', 'Guardar'))) return;
    const body = { grado: $('#fGrado').value, nombre: $('#fNombre').value, apellidos: $('#fApellidos').value, genero, cancion: $('#fCancion').value, descripcion: $('#fDesc').value, tribute, inEvaluation: $('#fEval').checked && !tribute };
    if (photoData) body.photo = photoData;
    if (editing && removePhotoFlag) body.removePhoto = true;
    $('#pSubmit').disabled = true;
    try {
      let id = editing;
      if (editing) await api('/participants/' + editing, body, 'PUT');
      else id = (await api('/participants', body)).id;
      if (audioFile) await upload(`/participants/${id}/audio`, audioFile, $('#upbar'));
      else if (removeAudioFlag && editing) await api(`/participants/${id}/audio`, null, 'DELETE');
      FV.toast(editing ? 'Cambios guardados' : 'Participante agregado', 'ok');
      resetForm(); $('#fGrado').focus();
    } catch {} finally { $('#pSubmit').disabled = false; }
  };

  /* ================= jurado ================= */
  function renderJuryMini() {
    const J = A.jury, R = J.results;
    $('#jStatusPill').innerHTML = pill(J.status.status);
    $('#jBadge').innerHTML = R.ties.length || R.objections.length ? `<span class="badge">${R.ties.length + R.objections.length}</span>` : '';
    const parts = A.participantsFull.filter((p) => p.inEvaluation && !p.tribute).length;
    $('#jMini').innerHTML = `
      ${J.status.status === 'open' ? (J.status.endsAt ? `<div class="bigclock gold-text" data-clock="${J.status.endsAt}">--:--</div>` : '<div class="bigclock gold-text">∞</div>') : ''}
      <p class="muted small">${J.judges.length} jurado(s) · ${parts} participante(s) en evaluación</p>
      ${R.progress.map((p) => `<div class="judge" style="padding:8px 12px"><b style="font-size:.88rem">${FV.esc(p.nombre)}</b><span class="muted small">${p.saved}/${p.total}</span><div class="prog"><i style="width:${p.total ? (p.saved / p.total) * 100 : 0}%"></i></div></div>`).join('')}
      ${R.allApproved ? '<div class="alert ok">✓ Ganadores certificados por el jurado.</div>' : R.ties.length ? `<div class="alert warn">⚖ ${R.ties.length} empate(s) en deliberación.</div>` : ''}
      <button class="btn ghost sm" data-goto="jurado">Ir a la gestión del jurado →</button>`;
  }
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) document.querySelector(`#tabs [data-tab="${g.dataset.goto}"]`).click(); });

  function renderJury() {
    const J = A.jury, R = J.results, st = J.status;
    $('#juryUrl').textContent = location.origin + '/jurado';
    $('#jCount').textContent = `(${J.judges.length}/${A.maxJudges})`;
    $('#jForm').hidden = J.judges.length >= A.maxJudges;
    $('#judges').innerHTML = J.judges.map((j) => {
      const pr = R.progress.find((x) => x.id === j.id) || { saved: 0, total: 0 };
      return `<div class="judge" data-j="${j.id}">
        <div><b>⚖️ ${FV.esc(j.nombre)}</b><div class="cred">Usuario: <span>${FV.esc(j.usuario)}</span> · Clave: <span>${FV.esc(j.clave)}</span></div></div>
        <div class="acts"><button class="btn ghost sm" data-copy>Copiar</button><button class="btn ghost sm" data-regen>Nueva clave</button><button class="btn danger sm" data-jdel>✕</button></div>
        <div class="prog" title="${pr.saved}/${pr.total} evaluados"><i style="width:${pr.total ? (pr.saved / pr.total) * 100 : 0}%"></i></div></div>`;
    }).join('') || '<p class="muted">Registre a los 5 miembros del jurado. El sistema generará su usuario y clave.</p>';

    // proceso
    $('#jPill').innerHTML = pill(st.status);
    const parts = A.participantsFull.filter((p) => p.inEvaluation && !p.tribute);
    if (st.status === 'open') {
      $('#jInfo').innerHTML = st.endsAt ? `<div class="bigclock gold-text" data-clock="${st.endsAt}">--:--</div><div class="muted small">Cierra automáticamente: ${fmtDate(st.endsAt)}</div>` : `<div class="bigclock gold-text">∞</div><div class="muted small">Sala abierta sin límite de tiempo, hasta que usted la cierre.</div>`;
      $('#jCtrls').innerHTML = `<hr class="sep"><div class="row"><button class="btn danger" data-jact="stop">■ Cerrar sala de evaluación</button>${st.endsAt ? '<button class="btn ghost sm" data-jext="5">+5 min</button><button class="btn ghost sm" data-jext="15">+15 min</button><button class="btn ghost sm" data-jext="60">+1 h</button>' : ''}</div>`;
    } else {
      const closed = st.status === 'closed';
      $('#jInfo').innerHTML = `<p class="muted small" style="margin:4px 0 0">${closed ? 'La sala está cerrada: los jurados ya no pueden guardar puntuaciones, pero sí votar desempates y aprobar ganadores.' : `Solo usted puede abrir la sala. Los jurados verán las fichas de los <b>${parts.length}</b> participantes enviados a evaluación.`}</p>
        ${!J.judges.length ? '<div class="alert warn">Registre a los jurados antes de abrir la sala.</div>' : ''}${!parts.length ? '<div class="alert warn">Envíe participantes a evaluación (pestaña Participantes).</div>' : ''}
        ${R.ungendered.length ? `<div class="alert warn">${R.ungendered.length} participante(s) en evaluación sin categoría: ${R.ungendered.map((p) => FV.esc(FV.fullName(p))).join(', ')}.</div>` : ''}`;
      $('#jCtrls').innerHTML = `<hr class="sep">` + timeCtrls('j', closed, 'jStart', 'jReopen');
    }

    renderDelib(); renderMatrix(); renderCategories();
  }
  $('#jForm').onsubmit = (e) => { e.preventDefault(); api('/judges', { nombre: $('#jName').value }).then((r) => { $('#jName').value = ''; FV.toast(`Jurado registrado · usuario ${r.judge.usuario} · clave ${r.judge.clave}`, 'ok'); }); };
  $('#judges').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const j = A.jury.judges.find((x) => x.id === b.closest('[data-j]').dataset.j);
    if (b.dataset.copy !== undefined) {
      const txt = `Festival de la Voz Ministerial — Sala del Jurado\n${location.origin}/jurado\nJurado: ${j.nombre}\nUsuario: ${j.usuario}\nClave: ${j.clave}`;
      navigator.clipboard.writeText(txt).then(() => FV.toast('Credenciales copiadas', 'ok'), () => FV.toast(txt));
    } else if (b.dataset.regen !== undefined) {
      if (await confirmBox('Nueva clave', `Se generará una nueva clave para <b>${FV.esc(j.nombre)}</b> y se cerrará su sesión actual.`, 'Generar')) api('/judges/' + j.id, { regenerate: true }, 'PUT');
    } else if (b.dataset.jdel !== undefined) {
      if (await confirmBox('Eliminar jurado', `¿Eliminar a <b>${FV.esc(j.nombre)}</b>? <b>Se borrarán todas sus puntuaciones.</b>`, 'Eliminar')) api('/judges/' + j.id, null, 'DELETE');
    }
  });
  $('#jCtrls').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act], button[data-jact], button[data-jext]'); if (!b) return;
    if (b.dataset.jext) return api('/jury/extend', { minutes: +b.dataset.jext }).then(() => FV.toast(`+${b.dataset.jext} min`, 'ok'));
    if (b.dataset.act === 'jStart') { if (await confirmBox('Abrir sala de evaluación', `Los jurados podrán evaluar ${windowText('j')}.`, 'Abrir')) api('/jury/start', windowBody('j')).then(() => FV.toast('Sala de evaluación abierta', 'ok')); }
    if (b.dataset.act === 'jReopen') api('/jury/extend', { minutes: presetMin.j || 15 }).then(() => FV.toast('Sala reabierta', 'ok'));
    if (b.dataset.jact === 'stop') { if (await confirmBox('Cerrar sala de evaluación', 'Los jurados ya no podrán guardar puntuaciones.', 'Cerrar')) api('/jury/stop', {}); }
  });

  function renderDelib() {
    const J = A.jury, R = J.results, box = $('#delib');
    if (!R.deliberation) {
      box.innerHTML = `<p class="muted">La deliberación comienza cuando <b>todos los jurados</b> terminen de evaluar a <b>todos</b> los participantes (o cuando usted cierre la sala).</p>
        ${R.progress.map((p) => `<div class="apl"><span class="grow">${FV.esc(p.nombre)}</span><span class="pill ${p.saved === p.total && p.total ? 'ok' : 'idle'}">${p.saved}/${p.total}</span></div>`).join('')}`;
      return;
    }
    const nameOf = (id) => { const j = J.judges.find((x) => x.id === id); return j ? j.nombre : '—'; };
    let html = '';
    if (!R.complete) html += `<div class="alert warn">La sala se cerró sin que todos los jurados completaran sus evaluaciones. Los resultados usan las puntuaciones existentes.</div>`;
    for (const t of R.ties) {
      html += `<div class="tiebox"><h4>⚖ Empate · ${placeName[t.position]} · ${G[t.genero]} ${t.round > 1 ? `· ronda ${t.round}` : ''}</h4>
        <div class="muted small">${t.total} puntos cada uno. ${t.needsAdmin ? '<b style="color:#ffe48a">El jurado no logró mayoría: decida usted.</b>' : `Votos del jurado: ${Object.keys(t.votes).length}/${J.judges.length}.`}</div>
        <div class="cands">${t.candidates.map((c) => {
          const voters = Object.entries(t.votes).filter(([, v]) => v === c.id).map(([j]) => nameOf(j));
          return `<div class="cand"><span class="av">${FV.photoHtml(c)}</span><span class="grow">${FV.esc(FV.fullName(c))}<small>${voters.length ? 'Votos: ' + voters.map(FV.esc).join(', ') : 'Sin votos'}</small></span><button class="btn ghost sm" data-decide="${t.key}" data-pid="${c.id}">Decidir</button></div>`;
        }).join('')}</div></div>`;
    }
    const wl = (list) => list.map((w) => `<div class="wline"><span class="medal p${w.position}">${w.position}</span><span class="grow">${FV.esc(FV.fullName(w))}${w.tiebreak ? ' <small class="muted">(desempate)</small>' : ''}</span><b>${w.pct.toFixed(1)}%</b></div>`).join('') || '<p class="muted small">Pendiente</p>';
    html += `<div class="winners2"><div class="wbox"><h4 style="color:#ffb3bd">Voz Femenina</h4>${wl(R.winners.F)}</div><div class="wbox"><h4 style="color:#bcd0ff">Voz Masculina</h4>${wl(R.winners.M)}</div></div>`;
    if (R.allResolved) {
      html += `<hr class="sep"><h3 class="h3">Aprobación del jurado (${R.approvedBy.length}/${J.judges.length})</h3>`;
      html += J.judges.map((j) => {
        const a = J.approvals[j.id];
        const cur = a && a.sig === R.sig;
        const s = cur && a.ok ? '<span class="pill ok">✓ APROBÓ</span>' : cur && !a.ok ? '<span class="pill warn">OBSERVACIÓN</span>' : '<span class="pill idle">PENDIENTE</span>';
        return `<div class="apl"><span class="grow">${FV.esc(j.nombre)}${cur && !a.ok ? `<span class="note">«${FV.esc(a.note)}»</span>` : ''}</span>${s}</div>`;
      }).join('');
      if (R.staleApprovals) html += `<div class="alert warn">Los ganadores cambiaron después de algunas aprobaciones (por modificaciones). Esas aprobaciones ya no cuentan.</div>`;
      html += R.allApproved ? `<div class="alert ok">✓ Resultados certificados. Puede anunciarlos desde «En vivo → Premiación del jurado».</div>` : '';
    }
    html += `<div class="row" style="margin-top:12px"><button class="btn ghost sm" id="reApprove">Solicitar nueva aprobación</button><button class="btn ghost sm" id="clearDec">Anular desempates</button></div>`;
    box.innerHTML = html;
    $('#reApprove').onclick = async () => { if (await confirmBox('Nueva aprobación', 'Todos los jurados deberán aprobar de nuevo a los ganadores.', 'Solicitar')) api('/jury/approvals/reset', {}); };
    $('#clearDec').onclick = async () => { if (await confirmBox('Anular desempates', 'Se borrarán todas las decisiones de desempate; los jurados votarán de nuevo.', 'Anular')) api('/jury/decisions/clear', {}); };
  }
  $('#delib').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-decide]'); if (!b) return;
    const p = A.participantsFull.find((x) => x.id === b.dataset.pid);
    if (await confirmBox('Decisión del administrador', `<b>${FV.esc(FV.fullName(p))}</b> ocupará este puesto. Quedará registrado en el historial.`, 'Confirmar')) api('/jury/decide', { key: b.dataset.decide, participantId: b.dataset.pid });
  });

  function renderMatrix() {
    const J = A.jury, R = J.results;
    if (!J.judges.length || !R.totals.length) { $('#matrix').innerHTML = '<p class="muted">Registre jurados y envíe participantes a evaluación para ver la planilla.</p>'; return; }
    const sum = (c) => c.reduce((a, b) => a + b, 0);
    $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th>Participante</th>${J.judges.map((j) => `<th title="${FV.esc(j.nombre)}">${FV.esc(j.nombre.split(' ')[0])}</th>`).join('')}<th>Total</th><th>%</th></tr></thead><tbody>
      ${R.totals.map((t) => `<tr><td>${t.number}. ${FV.esc(FV.fullName(t))} ${t.genero ? `<span class="chip-gender ${t.genero}" style="padding:2px 6px">${t.genero}</span>` : ''}</td>
        ${J.judges.map((j) => { const s = J.scores[j.id] && J.scores[j.id][t.id]; return `<td class="cell ${s ? (s.editedByAdmin ? 'edited' : '') : 'empty'}" data-j="${j.id}" data-p="${t.id}" title="${s ? s.c.join(' + ') : 'Sin evaluar'}">${s ? sum(s.c) : '—'}</td>`; }).join('')}
        <td class="tot">${t.total}</td><td class="tot">${t.pct.toFixed(1)}%</td></tr>`).join('')}
    </tbody></table><p class="muted small" style="margin:8px 0 0">En amarillo: puntuaciones modificadas por el administrador.</p>`;
  }
  $('#matrix').addEventListener('click', (e) => {
    const td = e.target.closest('td.cell'); if (!td) return;
    const J = A.jury, j = J.judges.find((x) => x.id === td.dataset.j), p = A.participantsFull.find((x) => x.id === td.dataset.p);
    const s = J.scores[j.id] && J.scores[j.id][p.id];
    $('#scoreBox').innerHTML = `<h2>Evaluación</h2><p style="margin:-6px 0 0"><b>${FV.esc(j.nombre)}</b> → <b>${FV.esc(FV.fullName(p))}</b><br><span class="muted small">${s ? `Guardada: ${fmtDate(s.t)}${s.editedByAdmin ? ' · modificada por el administrador' : ''}` : 'Aún sin evaluar'}</span></p>
      <div class="score-grid">${J.criteria.map((c, i) => `<div class="sc"><span>${FV.esc(c.name)}</span><input type="number" min="1" max="20" value="${s ? s.c[i] : ''}" data-ci="${i}"></div>`).join('')}</div>
      <div class="alert warn" style="margin-top:0">Toda modificación queda registrada en el historial.</div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost sm" id="scClose">Cerrar</button>${s ? '<button class="btn ghost sm" id="scUnlock">Desbloquear (re-evaluar)</button>' : ''}<button class="btn danger sm" id="scSave">Guardar modificación</button></div>`;
    $('#scoreModal').classList.add('show');
    $('#scClose').onclick = () => $('#scoreModal').classList.remove('show');
    $('#scSave').onclick = () => {
      const c = [...$$('#scoreBox [data-ci]')].map((x) => +x.value);
      if (c.some((n) => !(n >= 1 && n <= 20 && Number.isInteger(n)))) return FV.toast('Cada aspecto debe estar entre 1 y 20', 'error');
      api('/jury/scores', { judgeId: j.id, participantId: p.id, c }, 'PUT').then(() => { $('#scoreModal').classList.remove('show'); FV.toast('Puntuación modificada', 'ok'); });
    };
    if ($('#scUnlock')) $('#scUnlock').onclick = () => api('/jury/scores', { judgeId: j.id, participantId: p.id }, 'DELETE').then(() => { $('#scoreModal').classList.remove('show'); FV.toast('El jurado podrá evaluar de nuevo a este participante', 'ok'); });
  });
  $('#jCsv').onclick = () => download('/jury/export.csv', 'evaluacion-jurado-2026.csv');

  function renderCategories() {
    const R = A.jury.results;
    for (const g of ['F', 'M']) {
      const wins = Object.fromEntries(R.winners[g].map((w) => [w.id, w.position]));
      const ordered = [...R.categories[g]].sort((a, b) => (wins[a.id] || 99) - (wins[b.id] || 99) || b.total - a.total);
      $('#cat' + g).innerHTML = ordered.map((t, i) => `<div class="rk ${wins[t.id] ? 'win' : ''}"><div class="pos">${wins[t.id] ? `<span class="medal p${wins[t.id]}">${wins[t.id]}</span>` : i + 1}</div><div class="av">${FV.photoHtml(t)}</div>
        <div style="min-width:0"><div class="nm">${FV.esc(FV.fullName(t))}</div><div class="bar"><div style="width:${t.pct}%"></div></div></div>
        <div class="v">${t.pct.toFixed(1)}%<small>${t.total} pts · ${t.count}/${A.jury.judges.length}</small></div></div>`).join('') || '<p class="muted">Sin participantes en esta categoría.</p>';
    }
  }

  /* ================= comunidad ================= */
  function renderCommunity() {
    const C = A.community;
    $('#kFans').textContent = C.fans; $('#kLikes').textContent = C.likes; $('#kLikes2').textContent = C.likes; $('#kPending').textContent = C.pending;
    $('#cBadge').innerHTML = C.pending ? `<span class="badge">${C.pending}</span>` : '';
    const pname = (pid) => { const p = A.participantsFull.find((x) => x.id === pid); return p ? FV.fullName(p) : '—'; };
    const list = C.comments.filter((c) => commentFilter === 'all' || c.status === 'pending');
    $('#comments').innerHTML = list.map((c) => `<div class="cm ${c.status}" data-c="${c.id}" data-f="${c.fanId}">
      <div><div class="who">${FV.esc(c.nombre)}<small>→ ${FV.esc(pname(c.pid))} · ${FV.timeAgo(c.t)}${c.status === 'pending' ? ' · por aprobar' : ''}</small></div><p>${FV.esc(c.text)}</p></div>
      <div class="acts">${c.status === 'pending' ? '<button class="ok" data-ok>Aprobar</button>' : ''}<button class="del" data-del>Eliminar</button><button data-ban>Bloquear usuario</button></div></div>`).join('') || `<p class="muted">${commentFilter === 'pending' ? 'No hay comentarios por aprobar.' : 'Aún no hay comentarios.'}</p>`;
  }
  $('#cFilter').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; commentFilter = b.dataset.f; $$('#cFilter button').forEach((x) => x.classList.toggle('on', x === b)); renderCommunity(); };
  $('#comments').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const el = b.closest('.cm');
    if (b.dataset.ok !== undefined) api(`/comments/${el.dataset.c}/approve`, {});
    if (b.dataset.del !== undefined) api(`/comments/${el.dataset.c}`, null, 'DELETE').then(() => FV.toast('Comentario eliminado', 'ok'));
    if (b.dataset.ban !== undefined && await confirmBox('Bloquear usuario', 'Se eliminarán todos sus comentarios y no podrá volver a comentar ni dar me gusta.', 'Bloquear')) api(`/fans/${el.dataset.f}/ban`, { banned: true });
  });
  function renderLikes() {
    const ps = [...A.participants].sort((a, b) => b.likes - a.likes);
    const max = ps[0]?.likes || 0;
    $('#likesRank').innerHTML = ps.map((p, i) => `<div class="rk"><div class="pos">${i + 1}</div><div class="av">${FV.photoHtml(p)}</div><div style="min-width:0"><div class="nm">${FV.esc(FV.fullName(p))}${p.tribute ? ' 🕯️' : ''}</div><div class="bar"><div style="width:${max ? (p.likes / max) * 100 : 0}%"></div></div></div><div class="v">❤ ${p.likes}<small>💬 ${p.comments}</small></div></div>`).join('') || '<p class="muted">Sin participantes.</p>';
  }
  const toggle = (id, key) => ($(id).onchange = (e) => api('/settings', { [key]: e.target.checked }).then(() => FV.toast('Guardado', 'ok')));
  toggle('#sComments', 'commentsEnabled'); toggle('#sPremod', 'commentsPremod'); toggle('#sLikes', 'likesEnabled'); toggle('#sPhotos', 'showPhotos'); toggle('#sStrict', 'strictMode');

  /* ================= página, video y QR ================= */
  function renderSettings() {
    const s = A.settings;
    const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v || ''; };
    set('#sTitle', s.title); set('#sEdition', s.edition); set('#sYear', s.year); set('#sTagline', s.tagline); set('#sDesc', s.description); set('#sUrl', s.publicUrl);
    $('#sComments').checked = s.commentsEnabled; $('#sPremod').checked = s.commentsPremod; $('#sLikes').checked = s.likesEnabled; $('#sPhotos').checked = s.showPhotos; $('#sStrict').checked = s.strictMode;
    $('#defUrl').textContent = location.origin + '/';
    const u = encodeURIComponent(votingUrl());
    $('#qrPrev').src = `/api/qr.svg?u=${u}`; $('#qrDl').href = `/api/qr.png?u=${u}`;
    $('#screenUrl').textContent = screenLink();
    const isLocal = /localhost|127\.0\.0\.1/.test(location.hostname);
    $('#lanUrls').innerHTML = isLocal && A.lanUrls.length ? '<span class="muted small" style="width:100%">Direcciones en la red local:</span>' + A.lanUrls.map((x) => `<button data-u="${x}">${x}</button>`).join('') : '';
    const vb = $('#videoBox');
    if ((vb.dataset.v || '') !== (s.video || '')) { vb.dataset.v = s.video || ''; vb.innerHTML = s.video ? `<video src="${FV.esc(s.video)}" controls preload="metadata" playsinline></video>` : '<p class="muted">No hay video cargado.</p>'; }
    $('#videoRemove').hidden = !s.video;
    const st = A.storage || {};
    const si = $('#storageInfo');
    si.className = 'alert ' + (st.failures ? 'err' : 'ok');
    si.innerHTML = st.mode === 'supabase'
      ? (st.failures ? `⚠ No se pudo guardar en Supabase (${st.failures} intentos): ${FV.esc(st.lastError || '')}. Se reintenta automáticamente; los datos siguen en memoria y en la copia local.` : `☁ Datos, fotos, audios y video guardados en <b>Supabase</b>${st.lastSavedAt ? ` · último guardado ${new Date(st.lastSavedAt).toLocaleTimeString('es-VE')}` : ''}.`)
      : (st.ephemeral
        ? '⚠ <b>Los datos se BORRAN con cada instalación.</b> Falta la variable <code>DATA_DIR=/var/data</code> (y un disco con esa ruta) en Render. Descargue un respaldo ahora.'
        : `💾 Datos guardados en el disco del servidor: <code>${FV.esc(st.dir || '')}</code>. Verifique que sea la ruta de su disco permanente (en Render, <code>/var/data</code>).`);
    if (st.ephemeral) si.className = 'alert err';
  }
  $('#saveTexts').onclick = () => api('/settings', { title: $('#sTitle').value, edition: $('#sEdition').value, year: $('#sYear').value, tagline: $('#sTagline').value, description: $('#sDesc').value }).then(() => FV.toast('Textos guardados', 'ok'));
  $('#lanUrls').onclick = (e) => { const b = e.target.closest('button'); if (b) $('#sUrl').value = b.dataset.u; };
  $('#saveUrl').onclick = () => api('/settings', { publicUrl: $('#sUrl').value.trim() }).then(() => FV.toast('URL del QR guardada', 'ok'));
  $('#copyScreen').onclick = () => navigator.clipboard.writeText(screenLink()).then(() => FV.toast('Enlace copiado', 'ok'), () => FV.toast(screenLink()));
  $('#regenKey').onclick = async () => { if (await confirmBox('Nueva clave de pantalla', 'Las pantallas abiertas con el enlace anterior dejarán de funcionar.', 'Generar')) api('/settings', { regenScreenKey: true }); };
  $('#videoPick').onclick = () => $('#videoFile').click();
  $('#videoFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 120 * 1048576) return FV.toast('El video supera 120 MB.', 'error');
    try { await upload('/media/video', f, $('#vupbar')); FV.toast('Video cargado', 'ok'); } catch {}
  };
  $('#videoRemove').onclick = async () => { if (await confirmBox('Quitar video', 'El video dejará de mostrarse en la página de inicio.', 'Quitar')) api('/media/video', null, 'DELETE'); };
  $('#backup').onclick = () => download('/backup.json', 'respaldo-festival.json');
  $('#restore').onclick = () => $('#restoreFile').click();
  $('#restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch { return FV.toast('El archivo no es un respaldo válido (.json).', 'error'); }
    if (!data || !Array.isArray(data.participants)) return FV.toast('El archivo no parece un respaldo del festival.', 'error');
    const n = { p: data.participants.length, j: (data.judges || []).length, c: (data.comments || []).length };
    if (!(await confirmBox('Restaurar respaldo', `El respaldo contiene <b>${n.p} participantes</b>, <b>${n.j} jurados</b> y <b>${n.c} comentarios</b>. <br><br>Reemplazará <b>todo lo que hay ahora</b> (se guarda una copia de lo actual en el servidor). Las fotos y audios no vienen en el respaldo: se reconectan solos si siguen en el disco.`, 'Restaurar'))) return;
    try {
      const r = await api('/restore', data);
      const falta = r.photosMissing ? ` Faltan ${r.photosMissing} fotos y ${r.audiosMissing} audios: súbalos de nuevo en Participantes (Editar).` : '';
      FV.toast(`Restaurado: ${r.participantes} participantes, ${r.jurados} jurados, ${r.likes} me gusta, ${r.comentarios} comentarios. Fotos reconectadas: ${r.relinked.photos}.${falta}`, r.photosMissing ? 'info' : 'ok');
    } catch {}
  };
  $('#relink').onclick = () => api('/relink-media', {}).then((r) => FV.toast(r.storage !== 'local' ? 'Con Supabase los archivos ya se enlazan solos.' : `Reconectadas ${r.photos} fotos, ${r.audios} audios${r.video ? ' y el video' : ''}.`, 'ok')).catch(() => {});
  $('#resetVotes').onclick = async () => { if (await confirmBox('Reiniciar votos del público', 'Se borrarán <b>todos los votos</b> de la Voz de la Audiencia y sus ajustes. No se puede deshacer.', 'Reiniciar')) api('/voting/reset', {}).then(() => FV.toast('Votos reiniciados', 'ok')); };
  $('#resetJury').onclick = async () => { if (await confirmBox('Reiniciar evaluación del jurado', 'Se borrarán <b>todas las puntuaciones</b>, desempates y aprobaciones del jurado. Los jurados y participantes se conservan. No se puede deshacer.', 'Reiniciar')) api('/jury/reset', {}).then(() => FV.toast('Evaluación reiniciada', 'ok')); };

  /* ================= historial ================= */
  async function loadAudit() { try { auditAll = (await api('/audit')).audit; renderAudit(); } catch {} }
  function renderAudit() {
    const list = auditAll || A.audit || [];
    const t = $('#hType').value, q = $('#hSearch').value.trim().toLowerCase();
    const f = list.filter((x) => (!t || x.type === t) && (!q || (x.msg + ' ' + x.actor).toLowerCase().includes(q))).slice(0, 1500);
    $('#audit').innerHTML = f.map((x) => `<div class="${x.type || ''}"><time>${new Date(x.t).toLocaleString('es-VE')}</time><b>${FV.esc(x.actor || '')}</b><span>${FV.esc(x.msg)}</span></div>`).join('') || '<span class="muted">Sin registros.</span>';
  }
  $('#hType').onchange = renderAudit; $('#hSearch').oninput = renderAudit; $('#hReload').onclick = loadAudit;
})();
