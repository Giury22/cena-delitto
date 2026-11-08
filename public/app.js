import { teamColors, teamColorLabel } from './team-colors.js';

const main = document.querySelector('#main');
const actions = document.querySelector('#header-actions');
const dialog = document.querySelector('#team-dialog');
const deleteDialog = document.querySelector('#delete-dialog');
const passwordDialog = document.querySelector('#password-dialog');
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>';
let state = { role: 'guest' };
let authMode = 'register';
let adminView = false;
let toastTimer;
let pendingDelete = null;
let pendingPassword = null;
let adminFilters = { query: '', attendance: 'all', role: 'all' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const preferenceLabels = { yes: 'Sì, ci sto', no: 'Preferisco di no', undecided: 'Per me è uguale' };

function colorOptions(selected = '', teamId = null) {
  const taken = new Set((state.teams || []).filter(team => team.id !== teamId).map(team => team.color));
  const allTaken = Object.keys(teamColors).every(color => taken.has(color));
  return `<option value="">${allTaken ? 'Tutti i colori sono già stati scelti' : 'Scegli un colore'}</option>` + Object.entries(teamColors).map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''} ${taken.has(value) ? 'disabled' : ''}>${label}${taken.has(value) ? ' (già scelto)' : ''}</option>`).join('');
}
function colorBadge(team) {
  const color = Object.hasOwn(teamColors, team.color) ? team.color : '';
  return `<span class="team-color"><i class="color-swatch" data-color="${color}" aria-hidden="true"></i>${teamColorLabel(color)}</span>`;
}
document.querySelector('#team-color').innerHTML = colorOptions();

async function api(url, method = 'GET', data) {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Qualcosa non ha funzionato. Riprova.');
  return result;
}
function toast(message) {
  const element = document.querySelector('#toast');
  clearTimeout(toastTimer); element.textContent = message; element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}
async function busy(button, task, errorElement) {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (errorElement) errorElement.textContent = '';
  try { await task(); }
  catch (error) { if (errorElement) errorElement.textContent = error.message; else toast(error.message); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); }
}
function render() {
  actions.innerHTML = state.role === 'guest' ? '<span class="header-note"><i></i> Gli inviti sono aperti</span>' : `<span class="header-note session-label">${state.role === 'admin' ? esc(state.admin.firstName + ' ' + state.admin.lastName) : esc(state.user.nickname)}</span><button class="text-button" id="logout">Esci <span aria-hidden="true">↗</span></button>`;
  document.querySelector('#logout')?.addEventListener('click', event => busy(event.currentTarget, async () => {
    await api('/api/auth/logout', 'POST', {}); state = { role: 'guest' }; adminView = false; adminFilters = { query: '', attendance: 'all', role: 'all' }; render();
  }));
  document.querySelector('#admin-link').hidden = state.role === 'admin';
  if (state.role === 'admin') renderAdmin();
  else if (state.role === 'participant') renderParticipant();
  else renderGuest();
}
function renderGuest() {
  main.innerHTML = `<section class="welcome"><div class="welcome-copy"><span class="eyebrow"><span class="tiny-line"></span> L’INVITO È PER TE</span><h1>Amici a tavola.<br><em>Complici per caso.</em></h1><p class="lead">Una cena, la tua squadra e un mistero da risolvere.<br>Scegli i tuoi complici. Al tuo alibi pensiamo dopo.</p><div class="invitation-art" aria-hidden="true"><div class="art-sticker">ALIBI<br>IN CORSO</div><span class="orbit-spark">✦</span><div class="art-caption">IL PROSSIMO INDIZIO?<br>ESSERCI.</div><div class="fork"><i></i><i></i><i></i></div><div class="plate"><div class="plate-inner"><span class="plate-star">✳</span><span>UN POSTO<br>TI ASPETTA</span><small>c · d</small></div></div><div class="knife"></div><div class="art-note">Porta il tuo intuito.<br>Al resto pensiamo noi.</div><div class="place-card">Tu porta un alibi. <span>↗</span></div></div><div class="welcome-bottom"><span>01 / PRENOTA IL TUO POSTO</span><span>IL RESTO È UN MISTERO</span></div></div><div class="auth-column"><div class="auth-card"><span class="eyebrow">${adminView ? 'DIETRO LE QUINTE' : 'IL TUO INVITO'}</span><h2>${adminView ? 'La regia è tua.' : authMode === 'register' ? 'Ci sarai?' : 'Bentornato a tavola.'}</h2><p>${adminView ? 'Accedi alla panoramica della serata.' : authMode === 'register' ? 'Bastano pochi dettagli per entrare in gioco.' : 'Riprendi da dove avevi lasciato.'}</p>${adminView ? '' : `<div class="auth-tabs" role="group" aria-label="Scegli come accedere"><button class="${authMode === 'register' ? 'active' : ''}" id="register-tab" type="button" aria-pressed="${authMode === 'register'}">Prima volta</button><button class="${authMode === 'login' ? 'active' : ''}" id="login-tab" type="button" aria-pressed="${authMode === 'login'}">Sono già in lista</button></div>`}<form id="auth-form">${adminView ? `<div class="input-pair"><div><label for="firstName">Nome</label><input id="firstName" name="firstName" autocomplete="given-name" maxlength="60" placeholder="Il tuo nome" required></div><div><label for="lastName">Cognome</label><input id="lastName" name="lastName" autocomplete="family-name" maxlength="60" placeholder="Il tuo cognome" required></div></div><label for="password">Password organizzatore</label><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="La chiave del mistero">` : `<div class="input-pair"><div><label for="firstName">Nome</label><input id="firstName" name="firstName" autocomplete="given-name" maxlength="60" placeholder="Il tuo nome" required></div><div><label for="lastName">Cognome</label><input id="lastName" name="lastName" autocomplete="family-name" maxlength="60" placeholder="Il tuo cognome" required></div></div>${authMode === 'register' ? '<label for="nickname">Come vuoi farti chiamare? <span>facoltativo</span></label><input id="nickname" name="nickname" autocomplete="nickname" maxlength="32" placeholder="Il tuo soprannome">' : ''}<label for="password">${authMode === 'register' ? 'Scegli la tua password' : 'La tua password'}</label><input id="password" name="password" type="password" autocomplete="${authMode === 'register' ? 'new-password' : 'current-password'}" required placeholder="La password che preferisci" aria-describedby="password-help"><small class="input-help" id="password-help">${authMode === 'register' ? 'Sceglila come vuoi, senza regole su lunghezza o caratteri. Ricordala per tornare al tuo profilo.' : 'Usa la password scelta quando ti sei iscritto.'}</small>`}<p class="form-error" id="auth-error" role="alert"></p><button type="submit" class="button primary full">${adminView ? 'Entra in regia' : authMode === 'register' ? 'Conferma la mia presenza' : 'Accedi al mio profilo'} <span aria-hidden="true">↗</span></button></form>${adminView ? '<button id="back-guest" class="text-button back-link">← Torna agli inviti</button>' : '<div class="auth-footnote"><span aria-hidden="true">◇</span> La squadra e il tuo ruolo? Li scegli dopo.</div>'}</div><p class="below-card">${adminView ? 'Usa la password configurata per accedere.' : 'Nessuna trama svelata. Nessuno spoiler. Solo tu e il tuo posto a tavola.'}</p></div></section><section class="steps" aria-label="Come funziona"><div><span>01</span><p><strong>Segna la tua presenza</strong>Nome, cognome e la password che vuoi. Sei dei nostri.</p></div><div><span>02</span><p><strong>Trova i tuoi complici</strong>Unisciti a una squadra o creane una.</p></div><div><span>03</span><p><strong>Entra nella parte</strong>Dicci se te la senti di fare l’assassino.</p></div></section>`;
  document.querySelector('#register-tab')?.addEventListener('click', () => { authMode = 'register'; renderGuest(); });
  document.querySelector('#login-tab')?.addEventListener('click', () => { authMode = 'login'; renderGuest(); });
  document.querySelector('#back-guest')?.addEventListener('click', () => { adminView = false; renderGuest(); });
  document.querySelector('#auth-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      state = await api(`/api/auth/${adminView ? 'admin' : authMode}`, 'POST', Object.fromEntries(new FormData(form)));
      render(); main.focus();
    }, document.querySelector('#auth-error'));
  });
}
function renderParticipant() {
  const { user, teams } = state;
  const team = teams.find(item => item.id === user.teamId);
  main.innerHTML = `<section class="page-intro"><div><span class="eyebrow">IL TUO POSTO A TAVOLA</span><h1>Ciao, <em>${esc(user.nickname)}.</em></h1><p>${user.attending ? 'Sei in lista. Ora scegli con chi condividere i sospetti.' : 'Hai rinunciato alla cena. Puoi riconfermare la presenza quando vuoi.'}</p></div><span class="status ${user.attending ? '' : 'muted'}"><i></i>${user.attending ? 'Presenza confermata' : 'Presenza rinunciata'}</span></section><div class="dashboard-grid"><section class="panel profile-panel"><div class="panel-heading"><span class="eyebrow">01 / IL TUO PROFILO</span><span aria-hidden="true">◇</span></div><h2>I dettagli fanno<br>la differenza.</h2><p class="profile-name">${esc(user.firstName)} ${esc(user.lastName)}</p><form id="profile-form"><label for="nickname">Il tuo soprannome</label><input id="nickname" name="nickname" value="${esc(user.nickname)}" required maxlength="32"><fieldset><legend>Te la senti di fare l’assassino?</legend><p class="input-help">È solo una preferenza: il ruolo sarà assegnato dall’organizzatore.</p>${Object.entries(preferenceLabels).map(([value, label]) => `<label class="radio-option"><input type="radio" name="killerPreference" value="${value}" ${user.killerPreference === value ? 'checked' : ''}><span>${label}</span><span class="radio-dot" aria-hidden="true"></span></label>`).join('')}</fieldset><label class="checkbox-line"><input type="checkbox" name="attending" ${user.attending ? 'checked' : ''}> Confermo che parteciperò alla cena</label><p id="profile-error" class="form-error" role="alert"></p><button class="button primary full" type="submit">Salva il profilo <span aria-hidden="true">↗</span></button></form></section><section class="teams-section"><div class="section-heading"><div><span class="eyebrow">02 / I TUOI COMPLICI</span><h2>Meglio accompagnati.</h2></div><button id="create-team" class="button light">＋ Crea squadra</button></div><p class="section-description">Scegli una squadra oppure creane una con il vostro colore. Puoi cambiare idea anche dopo.</p>${team ? `<div class="current-team"><div><span class="eyebrow">LA TUA SQUADRA</span><h3>${esc(team.name)}</h3><p>${team.members.length} ${team.members.length === 1 ? 'complice' : 'complici'} al tuo fianco, te compreso.</p>${colorBadge(team)}<form id="team-color-form"><label for="current-team-color">Colore della squadra</label><div class="team-color-controls"><select id="current-team-color" name="color" required>${colorOptions(team.color, team.id)}</select><button class="button light" type="submit">Salva colore</button></div><p class="form-error" id="team-color-error" role="alert"></p></form></div><button id="leave-team" class="button outline">Lascia squadra</button></div>` : '<div class="no-team"><span aria-hidden="true">↗</span><p><strong>Il tuo posto è confermato, la squadra ti aspetta.</strong>Puoi decidere con calma: intanto sei dei nostri.</p></div>'}<div class="team-grid">${teams.length ? teams.map((item, index) => `<article class="team-card ${item.id === user.teamId ? 'selected' : ''}"><div class="team-top"><span class="team-symbol" aria-hidden="true">${['✳', '◇', '✦', '⌘'][index % 4]}</span><span class="small-tag">${item.members.length} ${item.members.length === 1 ? 'persona' : 'persone'}</span></div><h3>${esc(item.name)}</h3>${colorBadge(item)}<p class="members">${item.members.length ? item.members.map(member => `${esc(member.nickname)}${member.attending ? '' : ' (assente)'}`).join(' · ') : 'Il primo posto è libero.'}</p><button class="button ${item.id === user.teamId ? 'light' : 'outline'} full join-team" data-team="${esc(item.id)}" ${item.id === user.teamId ? 'disabled' : ''}>${item.id === user.teamId ? '✓ Sei in questa squadra' : 'Unisciti alla squadra ↗'}</button></article>`).join('') : '<div class="empty-state"><span aria-hidden="true">✳</span><h3>La prima mossa è tua.</h3><p>Non ci sono ancora squadre.<br>Creane una e invita gli altri a unirsi.</p><button id="first-team" class="text-button">Crea la prima squadra ↗</button></div>'}</div><p class="quiet-note">Le preferenze sui ruoli sono visibili soltanto a te e all’organizzatore.</p></section></div>`;
  document.querySelector('#team-color-form')?.addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget;
    busy(form.querySelector('[type=submit]'), async () => {
      state = await api('/api/team/color', 'PATCH', Object.fromEntries(new FormData(form)));
      render(); toast('Colore della squadra aggiornato.');
    }, document.querySelector('#team-color-error'));
  });
  const openTeam = () => { document.querySelector('#team-form').reset(); document.querySelector('#team-color').innerHTML = colorOptions(); document.querySelector('#team-error').textContent = ''; dialog.showModal(); };
  document.querySelector('#create-team').addEventListener('click', openTeam);
  document.querySelector('#first-team')?.addEventListener('click', openTeam);
  document.querySelector('#profile-form').addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    busy(form.querySelector('[type=submit]'), async () => {
      state = await api('/api/me', 'PATCH', { nickname: values.get('nickname'), killerPreference: values.get('killerPreference'), attending: values.has('attending') });
      render(); toast('Profilo aggiornato. Tutto pronto.');
    }, document.querySelector('#profile-error'));
  });
  document.querySelectorAll('.join-team').forEach(button => button.addEventListener('click', () => busy(button, async () => {
    state = await api('/api/team', 'PATCH', { teamId: button.dataset.team }); render(); toast('Sei nella squadra. Buona complicità!');
  })));
  document.querySelector('#leave-team')?.addEventListener('click', event => busy(event.currentTarget, async () => {
    state = await api('/api/team', 'PATCH', { teamId: null }); render(); toast('Hai lasciato la squadra.');
  }));
}
function renderAdmin() {
  const { users, teams } = state;
  const confirmed = users.filter(user => user.attending);
  const counts = [confirmed.length, teams.length, confirmed.filter(user => !user.teamId).length, confirmed.filter(user => user.killerPreference === 'yes').length];
  main.innerHTML = `<section class="page-intro"><div><span class="eyebrow">LA REGIA DELLA SERATA</span><h1>Tutti gli indizi.<br><em>Un solo sguardo.</em></h1><p>Partecipanti, squadre e aspiranti assassini: qui hai tutto sotto controllo.</p></div><div class="admin-actions"><button id="refresh" class="button light">↻ Aggiorna</button><a class="button primary" href="/api/admin/export" download>Esporta CSV ↗</a></div></section><div class="stats">${['Presenze confermate', 'Squadre create', 'Ancora senza squadra', 'Disponibili come assassino'].map((label, i) => `<div class="stat"><span>${label}</span><strong>${counts[i].toString().padStart(2, '0')}</strong><small>${i === 0 ? `${users.length} iscrizioni totali` : ['','Tutti i gruppi, anche vuoti','Tra i partecipanti confermati','Tra i partecipanti confermati'][i]}</small></div>`).join('')}</div><section class="panel admin-panel"><div class="section-heading"><div><span class="eyebrow">IL REGISTRO DEGLI INVITATI</span><h2>Chi viene a cena.</h2></div></div><div class="filters"><label class="search-label"><span class="sr-only">Cerca partecipante o squadra</span><input id="search" type="search" placeholder="Cerca un nome, un soprannome, una squadra…"></label><label><span class="sr-only">Filtra partecipazione</span><select id="attendance-filter"><option value="all">Tutte le presenze</option><option value="yes">Confermate</option><option value="no">Rinunciate</option></select></label><label><span class="sr-only">Filtra preferenza assassino</span><select id="role-filter"><option value="all">Tutte le preferenze</option><option value="yes">Disponibili come assassino</option><option value="no">Preferiscono di no</option><option value="undecided">Indifferenti</option></select></label></div><div class="table-wrap"><table><caption class="sr-only">Partecipanti alla cena e preferenze</caption><thead><tr><th>Partecipante</th><th>Squadra</th><th>Presenza</th><th>Assassino?</th><th>Accesso</th><th class="delete-cell"><span class="sr-only">Azioni</span></th></tr></thead><tbody id="participants"></tbody></table></div><p id="table-count" class="quiet-note"></p></section><section class="admin-teams"><div class="section-heading"><div><span class="eyebrow">LE ALLEANZE</span><h2>Le squadre a tavola.</h2></div></div><div class="team-grid admin-team-grid">${teams.length ? teams.map((team, index) => { const members = users.filter(user => user.teamId === team.id); return `<article class="team-card"><div class="team-top"><span class="team-symbol" aria-hidden="true">${['✳', '◇', '✦', '⌘'][index % 4]}</span><div class="team-card-actions"><span class="small-tag">${members.filter(user => user.attending).length} confermati / ${members.length}</span><button type="button" class="delete-button" data-delete-team="${esc(team.id)}" aria-label="Elimina la squadra ${esc(team.name)}" title="Elimina squadra">${trashIcon}</button></div></div><h3>${esc(team.name)}</h3>${colorBadge(team)}<ul class="admin-members">${members.length ? members.map(user => `<li><span>${esc(user.firstName)} ${esc(user.lastName)}<small>${esc(user.nickname)}</small></span><span class="member-state ${user.attending ? '' : 'absent'}">${user.attending ? 'Confermato' : 'Assente'}</span></li>`).join('') : '<li>Nessun partecipante al momento.</li>'}</ul></article>`; }).join('') : '<div class="empty-state"><h3>Le alleanze devono ancora nascere.</h3><p>Le squadre appariranno qui appena qualcuno ne creerà una.</p></div>'}</div></section>`;
  function filter() {
    const query = document.querySelector('#search').value.trim().toLocaleLowerCase('it');
    const attendance = document.querySelector('#attendance-filter').value;
    const role = document.querySelector('#role-filter').value;
    adminFilters = { query: document.querySelector('#search').value, attendance, role };
    const filtered = users.filter(user => {
      const team = teams.find(item => item.id === user.teamId);
      return `${user.firstName} ${user.lastName} ${user.nickname} ${team?.name || ''}`.toLocaleLowerCase('it').includes(query) && (attendance === 'all' || user.attending === (attendance === 'yes')) && (role === 'all' || user.killerPreference === role);
    });
    document.querySelector('#participants').innerHTML = filtered.length ? filtered.map(user => `<tr><td><strong>${esc(user.firstName)} ${esc(user.lastName)}</strong><small>${esc(user.nickname)}</small></td><td>${esc(teams.find(team => team.id === user.teamId)?.name || 'Da scegliere')}${user.teamId ? colorBadge(teams.find(team => team.id === user.teamId) || {}) : ''}</td><td><span class="badge ${user.attending ? 'green' : ''}">${user.attending ? 'Confermata' : 'Rinunciata'}</span></td><td><span class="badge ${user.killerPreference === 'yes' ? 'ochre' : ''}">${esc(preferenceLabels[user.killerPreference])}</span></td><td><button type="button" class="button light" data-password-user="${esc(user.id)}" aria-label="Imposta una nuova password per ${esc(user.firstName)} ${esc(user.lastName)}">Nuova password</button></td><td class="delete-cell"><button type="button" class="delete-button" data-delete-user="${esc(user.id)}" aria-label="Elimina il profilo di ${esc(user.firstName)} ${esc(user.lastName)}" title="Elimina profilo">${trashIcon}</button></td></tr>`).join('') : `<tr><td colspan="6" class="table-empty">${users.length ? 'Nessun partecipante corrisponde ai filtri.' : 'La lista è ancora vuota. Il primo invito aspetta solo di essere condiviso.'}</td></tr>`;
    document.querySelector('#table-count').textContent = `${filtered.length} di ${users.length} partecipanti`;
  }
  document.querySelector('#search').value = adminFilters.query;
  document.querySelector('#attendance-filter').value = adminFilters.attendance;
  document.querySelector('#role-filter').value = adminFilters.role;
  document.querySelector('#participants').addEventListener('click', event => {
    const passwordButton = event.target.closest('[data-password-user]');
    if (passwordButton) openPasswordReset(passwordButton.dataset.passwordUser);
    const button = event.target.closest('[data-delete-user]');
    if (button) openDeletion('users', button.dataset.deleteUser);
  });
  document.querySelector('.admin-teams').addEventListener('click', event => {
    const button = event.target.closest('[data-delete-team]');
    if (button) openDeletion('teams', button.dataset.deleteTeam);
  });
  ['#search', '#attendance-filter', '#role-filter'].forEach(selector => document.querySelector(selector).addEventListener('input', filter));
  document.querySelector('#refresh').addEventListener('click', event => busy(event.currentTarget, async () => { state = await api('/api/state'); render(); toast('Panoramica aggiornata.'); }));
  filter();
}
function openPasswordReset(id) {
  if (state.role !== 'admin') return;
  const user = state.users.find(item => item.id === id);
  if (!user) return;
  document.querySelector('#password-form').reset();
  document.querySelector('#new-password').type = 'password';
  document.querySelector('#password-error').textContent = '';
  document.querySelector('#password-description').textContent = `Stai cambiando la password di ${user.firstName} ${user.lastName} (${user.nickname}). Scegli la nuova password e comunicala direttamente al partecipante.`;
  pendingPassword = id;
  passwordDialog.showModal();
}

document.querySelector('#cancel-password').addEventListener('click', () => passwordDialog.close());
document.querySelector('#show-new-password').addEventListener('change', event => {
  document.querySelector('#new-password').type = event.currentTarget.checked ? 'text' : 'password';
});
passwordDialog.addEventListener('close', () => {
  pendingPassword = null;
  document.querySelector('#password-form').reset();
  document.querySelector('#new-password').type = 'password';
});
passwordDialog.addEventListener('cancel', event => {
  if (document.querySelector('#save-password').disabled) event.preventDefault();
});
document.querySelector('#password-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingPassword || document.querySelector('#save-password').disabled) return;
  const id = pendingPassword;
  const password = document.querySelector('#new-password').value;
  const cancel = document.querySelector('#cancel-password');
  cancel.disabled = true;
  try {
    await busy(document.querySelector('#save-password'), async () => {
      state = await api(`/api/admin/users/${encodeURIComponent(id)}/password`, 'PATCH', { password });
      passwordDialog.close(); render(); main.focus({ preventScroll: true });
      toast('Password aggiornata. Il partecipante può accedere con quella nuova.');
    }, document.querySelector('#password-error'));
  } finally { cancel.disabled = false; }
});

function openDeletion(collection, id) {
  if (state.role !== 'admin') return;
  const item = state[collection].find(entry => entry.id === id);
  if (!item) return;
  const isUser = collection === 'users';
  const name = isUser ? `${item.firstName} ${item.lastName}` : item.name;
  const count = isUser ? 0 : state.users.filter(user => user.teamId === id).length;
  document.querySelector('#delete-title').textContent = isUser ? 'Eliminare questo profilo?' : 'Eliminare questa squadra?';
  document.querySelector('#delete-description').textContent = isUser
    ? `Vuoi eliminare il profilo di ${name}? Verrà rimosso dalla lista e dalla sua squadra. Per partecipare di nuovo dovrà iscriversi.`
    : `Vuoi eliminare la squadra «${name}»? ${count ? `I suoi ${count} membri resteranno iscritti, senza squadra, e potranno sceglierne un’altra.` : 'La squadra è vuota e verrà rimossa dall’elenco.'}`;
  document.querySelector('#delete-error').textContent = '';
  pendingDelete = { collection, id };
  deleteDialog.showModal();
}
document.querySelector('#cancel-delete').addEventListener('click', () => deleteDialog.close());
deleteDialog.addEventListener('close', () => { pendingDelete = null; });
deleteDialog.addEventListener('cancel', event => {
  if (document.querySelector('#confirm-delete').disabled) event.preventDefault();
});
document.querySelector('#delete-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!pendingDelete || document.querySelector('#confirm-delete').disabled) return;
  const target = pendingDelete;
  const cancel = document.querySelector('#cancel-delete');
  cancel.disabled = true;
  try {
    await busy(document.querySelector('#confirm-delete'), async () => {
      state = await api(`/api/admin/${target.collection}/${encodeURIComponent(target.id)}`, 'DELETE', {});
      deleteDialog.close(); render(); main.focus({ preventScroll: true });
      toast(target.collection === 'users' ? 'Profilo eliminato.' : 'Squadra eliminata. I partecipanti restano iscritti.');
    }, document.querySelector('#delete-error'));
  } finally { cancel.disabled = false; }
});
document.querySelector('#admin-link').addEventListener('click', () => {
  if (state.role === 'participant') { toast('Esci dal profilo per accedere come organizzatore.'); return; }
  adminView = true; renderGuest(); document.querySelector('#firstName').focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
document.querySelector('#team-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget;
  busy(form.querySelector('[type=submit]'), async () => {
    state = await api('/api/teams', 'POST', Object.fromEntries(new FormData(form))); dialog.close(); render(); toast('Squadra creata. Ora mancano solo i tuoi complici.');
  }, document.querySelector('#team-error'));
});
async function boot() {
  try { state = await api('/api/state'); render(); }
  catch (error) {
    main.innerHTML = '<section class="connection-error"><span class="eyebrow">UN PICCOLO IMPREVISTO</span><h1>Il tavolo non è ancora pronto.</h1><p id="connection-description"></p><button class="button primary" id="retry">Riprova ↻</button></section>';
    document.querySelector('#connection-description').textContent = error.message === 'Failed to fetch' ? 'Non riusciamo a contattare il server. Riprova tra poco.' : error.message;
    document.querySelector('#retry').addEventListener('click', boot);
  }
}
boot();
