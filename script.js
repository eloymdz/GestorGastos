/**
 * Expense Tracker - Serverless Edition (Supabase)
 */

// --- Supabase Config ---
const SUPABASE_URL = 'https://qcgabxqoqxtdrvugqalr.supabase.co';
const SUPABASE_KEY = 'sb_publishable__OQcd-N-fk5WSAM6eGdxfw_9UB-DPvG'; // Public Anon Key
const { createClient } = window.supabase;
var supabase = createClient(SUPABASE_URL, SUPABASE_KEY); // Usamos var para permitir re-declaración en caso de que el script se cargue doble

// --- Local Cache State (for UI rendering) ---
// We keep a local copy to avoid refactoring the entire UI logic, 
// but we refresh it from DB constantly.
let AppState = { people: [], groups: [] };
let currentGroupId = null;

// --- DataTables Instances ---
let tables = {};

// --- Initialization ---
$(document).ready(async function () {
    initLayout();

    // Check Session
    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
        // Logged in
        handleLoginSuccess(session.user);
    } else {
        // Not logged in
        showView('auth');
    }

    // Listen for auth changes
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') handleLoginSuccess(session.user);
        if (event === 'SIGNED_OUT') {
            AppState = { people: [], groups: [] }; // Clear state
            showView('auth');
        }
    });

    // Handle Login Form Submit
    $('#loginForm').submit(async (e) => {
        e.preventDefault();
        const email = $('#authEmail').val();
        const password = $('#authPassword').val();
        const isRegistering = $('#loginBtnText').text() === 'Registrarse'; // Simple toggle check logic

        if (isAuthRegisterMode) {
            const name = $('#authName').val().trim();
            if (!name) {
                alert('Por favor ingresa tu nombre completo');
                return;
            }
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        name: name  // Pasar nombre a metadata
                    }
                }
            });
            if (error) alert('Error registro: ' + error.message);
            else alert('¡Registro exitoso! Ya puedes iniciar sesión.');
        } else {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) alert('Error login: ' + error.message);
        }
    });
});

let isAuthRegisterMode = false;
function toggleAuthMode() {
    isAuthRegisterMode = !isAuthRegisterMode;
    const btn = $('#loginForm button[type="submit"]');
    const link = $('#view-auth .btn-link');
    const nameField = $('#nameFieldContainer');

    if (isAuthRegisterMode) {
        btn.text('Registrarse');
        btn.removeClass('btn-primary').addClass('btn-success');
        link.text('¿Ya tienes cuenta? Inicia Sesión');
        nameField.show();  // Mostrar campo nombre
    } else {
        btn.text('Iniciar Sesión');
        btn.removeClass('btn-success').addClass('btn-primary');
        link.text('Registrarse');
        nameField.hide();  // Ocultar campo nombre
    }
}

let currentSessionUser = null;
let currentUserPerson = null;  // Perfil del usuario en tabla people

async function handleLoginSuccess(user) {
    console.log("Logged in as:", user.email);
    currentSessionUser = user;

    // Cargar perfil del usuario (su registro en people)
    await loadUserProfile();

    try {
        await refreshData();
        showView('dashboard');
    } catch (e) {
        console.error(e);
    }
}

async function loadUserProfile() {
    if (!currentSessionUser) return;

    try {
        const { data, error } = await supabase
            .from('people')
            .select('*')
            .eq('user_id', currentSessionUser.id)
            .single();

        if (error) {
            console.error('Error cargando perfil:', error);
            return;
        }

        if (data) {
            currentUserPerson = data;
            console.log('Perfil cargado:', data.name);
        }
    } catch (e) {
        console.error(e);
    }
}

async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Error Logout:', error);
}

function initLayout() {
    $("#menu-toggle").click(function (e) {
        e.preventDefault();
        $("body").toggleClass("sb-sidenav-toggled");
    });
}


// --- Data Synchronization (The Core) ---
async function refreshData() {
    try {
        // 1. Fetch People
        const { data: people, error: errP } = await supabase.from('people').select('*');
        if (errP) throw errP;
        AppState.people = people || [];

        // 2. Fetch Groups (with Expenses Amount for totals AND members for filtering)
        const { data: groups, error: errG } = await supabase
            .from('groups')
            .select('*, expenses(amount), group_members(person_id)');
        if (errG) throw errG;

        // 3. For the simplified UI logic we have, we need to nest expenses and members.
        // In a real large app, we would load strictly on demand. For now, we mimic the old structure slightly
        // or trigger on-demand loading when opening a group. 
        // Let's load mainly the list first.

        AppState.groups = groups
            .filter(g => {
                const isCreator = currentSessionUser && g.created_by === currentSessionUser.id;
                const isPublic = g.is_public;

                // Check if current user is a member
                let isMember = false;
                if (currentUserPerson && g.group_members) {
                    isMember = g.group_members.some(gm => gm.person_id === currentUserPerson.id);
                }

                // REGLAS DE VISIBILIDAD:
                // 1. Siempre ver grupos propios (creados por mí)
                // 2. Ver grupos públicos donde soy miembro
                return isCreator || (isPublic && isMember);
            })
            .map(g => ({
                ...g,
                memberIds: [], // placeholder, loaded on detail
                // Calculate total from the 'expenses' relation we just fetched
                totalAmount: (g.expenses || []).reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0),
                expenses: []   // placeholder, will be fully loaded on detail view
            }));

    } catch (error) {
        console.error("Error fetching data:", error);
        alert("Error de BD: " + (error.message || error.error_description || JSON.stringify(error)));
    }
}

async function fetchGroupDetails(groupId) {
    // Load Members
    const { data: members, error: errM } = await supabase
        .from('group_members')
        .select('person_id')
        .eq('group_id', groupId);

    if (errM) console.error(errM);

    // Load Expenses
    const { data: expenses, error: errE } = await supabase
        .from('expenses')
        .select(`
            *,
            expense_involved (person_id)
        `)
        .eq('group_id', groupId);

    if (errE) console.error(errE);

    // Map to AppState structure
    const group = AppState.groups.find(g => g.id == groupId); // Loose query (string/int)
    if (group) {
        group.memberIds = (members || []).map(m => m.person_id);

        group.expenses = (expenses || []).map(e => ({
            id: e.id,
            desc: e.description,
            amount: parseFloat(e.amount),
            payerId: e.payer_id,
            type: e.type,
            borrowerId: e.borrower_id,
            involvedIds: (e.expense_involved || []).map(i => i.person_id),
            date: e.created_at
        }));
    }
}

// --- View Navigation ---
async function showView(viewName) {
    $('.list-group-item').removeClass('active');
    $(`#nav-${viewName}`).addClass('active');

    // Hide all
    $('#view-auth, #view-dashboard, #view-groups, #view-people, #view-group-detail').addClass('d-none');

    // Sidebar: Hide on auth, Show on app
    if (viewName === 'auth') {
        $('#sidebar-wrapper').addClass('d-none'); // Hide sidebar on login
        $('#menu-toggle').addClass('d-none');
        $('#view-auth').removeClass('d-none');
        return;
    } else {
        $('#sidebar-wrapper').removeClass('d-none');
        $('#menu-toggle').removeClass('d-none');
    }

    if (viewName === 'dashboard') {
        $('#view-dashboard').removeClass('d-none');
        await refreshData();
        renderDashboard();
    } else if (viewName === 'groups') {
        $('#view-groups').removeClass('d-none');
        await refreshData();
        renderGroupsTable();
    } else if (viewName === 'people') {
        $('#view-people').removeClass('d-none');
        await refreshData();
        renderPeopleTable();
    }
}

// --- Helper for DataTable ---
function initTable(id, data, columns, createdRowCallback = null) {
    if ($.fn.DataTable.isDataTable('#' + id)) {
        $('#' + id).DataTable().destroy();
    }

    tables[id] = $('#' + id).DataTable({
        data: data,
        columns: columns,
        responsive: true,
        language: { url: "//cdn.datatables.net/plug-ins/1.13.4/i18n/es-ES.json" },
        createdRow: createdRowCallback
    });
}

// --- Dashboard ---
function renderDashboard() {
    const active = AppState.groups.filter(g => g.status === 'PENDING').length;
    $('#dash-total-groups').text(active);
    $('#dash-total-people').text(AppState.people.length);

    // Sort by created_at desc
    const data = AppState.groups.slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 5)
        .map(g => ({
            name: g.name,
            status: g.status,
            id: g.id
        }));

    initTable('dashGroupsTable', data, [
        { data: 'name' },
        {
            data: 'status',
            render: function (s) {
                return s === 'PAID'
                    ? '<span class="badge bg-success">Pagado</span>'
                    : '<span class="badge bg-warning text-dark">Pendiente</span>';
            }
        },
        {
            data: 'id',
            render: function (data) {
                return `<button class="btn btn-sm btn-primary" onclick="openGroupDetail(${data})">Ver</button>`;
            }
        }
    ]);
}

// --- Groups List ---
function renderGroupsTable() {
    // Note: Totals are inaccurate here because we didn't fetch deep expenses. 
    // For cloud apps, usually lists don't show heavy calculated totals unless indexed.
    // We will show '...' or 0 for now to keep it fast, or remove the column.

    const data = AppState.groups.map(g => {
        let dateStr = new Date(g.created_at).toLocaleDateString();
        if (g.status === 'PAID' && g.paid_at) {
            dateStr = 'Pagado: ' + new Date(g.paid_at).toLocaleDateString();
        }

        // Resolving Owner Name
        // Resolving Owner Name
        let ownerName = '<span class="text-muted">Desconocido</span>';
        if (g.created_by) {
            if (currentSessionUser && g.created_by === currentSessionUser.id) {
                ownerName = '<span class="badge bg-primary">Tú</span>';
            } else {
                ownerName = '<span class="badge bg-secondary">Otro</span>';
            }
        }
        // Fallback to legacy owner_id if exists/needed, or keep simpple

        // Calculate Total
        const total = g.totalAmount || 0;

        return {
            name: g.name,
            ownerName: ownerName,
            isPublic: g.is_public, // from DB
            status: g.status,
            date: dateStr,
            totalStr: '$' + total.toLocaleString('es-MX', { minimumFractionDigits: 2 }),
            id: g.id,
            createdBy: g.created_by
        };
    });

    initTable('groupsTable', data, [
        {
            data: 'name',
            render: function (data, type, row) {
                // Show Lock/Globe icon
                const visIcon = row.isPublic
                    ? '<i class="fas fa-globe-americas text-primary" title="Público"></i>'
                    : '<i class="fas fa-lock text-secondary" title="Privado"></i>';
                return `${visIcon} ${data}`;
            }
        },
        { data: 'ownerName' },
        {
            data: 'status',
            render: function (s) {
                return s === 'PAID'
                    ? '<span class="badge bg-success">Pagado</span>'
                    : '<span class="badge bg-warning text-dark">Pendiente</span>';
            }
        },
        { data: 'date' },
        { data: 'totalStr' },
        {
            data: 'id',
            className: 'text-end',
            render: function (id, type, row) {
                const isCreator = currentSessionUser && row.createdBy === currentSessionUser.id;
                const isPaid = row.status === 'PAID';

                // Common Button
                const viewBtn = `<button class="btn btn-sm btn-primary ms-1" title="Ver" onclick="openGroupDetail(${id})"><i class="fas fa-eye"></i></button>`;

                // SCENARIO 1: Not Creator -> READ ONLY
                if (!isCreator) {
                    return viewBtn;
                }

                // SCENARIO 2: Creator BUT Paid -> READ ONLY + REOPEN
                if (isPaid) {
                    const reopenBtn = `<button class="btn btn-sm btn-warning" title="Reabrir" onclick="toggleGroupStatus(${id}, 'PENDING')"><i class="fas fa-undo"></i></button>`;
                    return `${reopenBtn} ${viewBtn}`;
                }

                // SCENARIO 3: Creator AND Pending -> FULL CONTROL
                return `
                    <button class="btn btn-sm btn-info text-white" title="Editar" onclick="openGroupModal(${id})"><i class="fas fa-pencil"></i></button>
                    <button class="btn btn-sm btn-success mx-1" title="Marcar Pagado" onclick="toggleGroupStatus(${id}, 'PAID')"><i class="fas fa-check"></i></button>
                    <button class="btn btn-sm btn-danger" title="Eliminar" onclick="deleteGroup(${id})"><i class="fas fa-trash"></i></button>
                    ${viewBtn}
                `;
            }
        }
    ]);
}

async function toggleGroupStatus(id, currentStatus) {
    const newStatus = currentStatus === 'PENDING' ? 'PAID' : 'PENDING';
    const paidAt = newStatus === 'PAID' ? new Date().toISOString() : null;

    if (confirm(`¿Cambiar estado a ${newStatus}?`)) {
        const { error } = await supabase.from('groups')
            .update({ status: newStatus, paid_at: paidAt })
            .eq('id', id);

        if (error) alert('Error actualizando estado');
        else showView('groups');
    }
}

// --- Group Management (Create / Edit) ---
let editingGroupId = null;

function openGroupModal(id = null) {
    editingGroupId = id;

    if (id) {
        // Edit Mode
        const group = AppState.groups.find(g => g.id == id);
        if (!group) return;

        $('#groupModalTitle').text('Editar Grupo');
        $('#groupName').val(group.name);
        $('#groupPublic').prop('checked', group.isPublic);
    } else {
        // Create Mode
        $('#groupModalTitle').text('Nuevo Grupo');
        $('#groupName').val('');
        $('#groupPublic').prop('checked', false);
    }

    new bootstrap.Modal(document.getElementById('groupModal')).show();
}

async function saveGroup() {
    const name = $('#groupName').val().trim();
    const isPublic = $('#groupPublic').is(':checked');

    if (!name) { alert('Nombre requerido'); return; }

    const payload = {
        name: name,
        is_public: isPublic
        // created_by is handled automatically by Supabase for INSERT
        // owner_id (Legacy Person ID) is ignored for now to simplify
    };

    let error = null;

    if (editingGroupId) {
        // Update
        const res = await supabase.from('groups').update(payload).eq('id', editingGroupId);
        error = res.error;
    } else {
        // Insert
        const res = await supabase.from('groups').insert([payload]);
        error = res.error;
    }

    if (error) {
        alert('Error guardando grupo: ' + error.message);
    } else {
        bootstrap.Modal.getInstance(document.getElementById('groupModal')).hide();
        showView('groups');
    }
}

async function deleteGroup(id) {
    if (confirm('¿Eliminar grupo permanentemente?')) {
        const { error } = await supabase.from('groups').delete().eq('id', id);
        if (error) alert('Error eliminando grupo');
        else showView('groups');
    }
}

// --- People Global ---
function renderPeopleTable() {
    const data = AppState.people.map(p => ({
        name: p.name,
        hasAccount: !!p.user_id,  // TRUE si tiene cuenta
        id: p.id
    }));

    initTable('peopleTable', data, [
        {
            data: 'name',
            render: function (data, type, row) {
                const badge = row.hasAccount
                    ? '<span class="badge bg-success ms-2"><i class="fas fa-user-check"></i> Con Cuenta</span>'
                    : '<span class="badge bg-secondary ms-2"><i class="fas fa-user"></i> Invitado</span>';
                return data + badge;
            }
        },
        {
            data: 'id',
            render: function (id) {
                return `<button class="btn btn-danger btn-sm" onclick="deleteGlobalPerson(${id})"><i class="fas fa-trash"></i></button>`;
            }
        }
    ]);
}

async function addGlobalPerson() {
    const name = $('#globalPersonName').val().trim();
    if (name) {
        const { error } = await supabase.from('people').insert([{ name }]);
        if (error) alert('Error agregando persona: ' + error.message);
        else {
            $('#globalPersonName').val('');
            showView('people'); // Refresh
            alert('Persona agregada');
        }
    }
}

async function deleteGlobalPerson(id) {
    if (confirm('¿Eliminar del directorio global?')) {
        const { error } = await supabase.from('people').delete().eq('id', id);
        if (error) alert('Error: Puede que esté en un grupo. Elimínala de los grupos primero.');
        else showView('people');
    }
}

// --- Group Detail ---
async function openGroupDetail(id) {
    currentGroupId = id;

    // Switch view first for feedback
    $('#view-dashboard, #view-groups, #view-people, #view-group-detail').addClass('d-none');
    $('#view-group-detail').removeClass('d-none');

    // Fetch deep data
    await fetchGroupDetails(id);
    const group = AppState.groups.find(g => g.id == id);
    if (!group) return;

    // Check Permissions
    const isCreator = currentSessionUser && group.created_by === currentSessionUser.id;
    const isPaid = group.status === 'PAID';
    const isReadOnly = !isCreator || isPaid;

    let titleSuffix = '';
    if (isPaid) titleSuffix += ' <span class="badge bg-success small">Pagado</span>';
    if (!isCreator) titleSuffix += ' <span class="badge bg-secondary small">Vista</span>';

    $('#detailGroupName').html(group.name + titleSuffix);

    // Show/Hide "Registrar Gasto" button
    if (isReadOnly) {
        $('#btnNewExpense').addClass('d-none');
    } else {
        $('#btnNewExpense').removeClass('d-none');
    }

    var firstTabEl = document.querySelector('#view-group-detail .nav-link[href="#tab-expenses"]')
    var firstTab = new bootstrap.Tab(firstTabEl)
    firstTab.show()

    renderGroupExpenses();
    renderGroupBalances();
    renderGroupMembers();
}

// 1. Members
function renderGroupMembers() {
    const group = AppState.groups.find(g => g.id == currentGroupId);
    const list = $('#groupMembersList');
    list.empty();

    (group.memberIds || []).forEach(mid => {
        const p = AppState.people.find(x => x.id == mid);
        if (p) {
            list.append(`
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    ${p.name}
                    <button class="btn btn-sm btn-outline-danger" onclick="removeMember(${mid})"><i class="fas fa-times"></i></button>
                </li>
            `);
        }
    });

    const select = $('#selectPersonToAdd');
    select.empty().append('<option selected value="">Seleccionar...</option>');
    AppState.people.forEach(p => {
        if (!(group.memberIds || []).includes(p.id)) {
            select.append(`<option value="${p.id}">${p.name}</option>`);
        }
    });
}

async function addMemberToGroup() {
    const pid = $('#selectPersonToAdd').val();
    if (!pid) return;

    const { error } = await supabase
        .from('group_members')
        .insert([{ group_id: currentGroupId, person_id: pid }]);

    if (error) alert('Error añadiendo miembro');
    else await openGroupDetail(currentGroupId);
}

async function removeMember(mid) {
    if (confirm('¿Quitar del grupo?')) {
        const { error } = await supabase
            .from('group_members')
            .delete()
            .eq('group_id', currentGroupId)
            .eq('person_id', mid);

        if (error) alert('Error quitando miembro');
        else await openGroupDetail(currentGroupId);
    }
}

// 2. Expenses
function renderGroupExpenses() {
    const group = AppState.groups.find(g => g.id == currentGroupId);
    const data = (group.expenses || []).map(e => {
        const p = AppState.people.find(x => x.id == e.payerId);
        const payerName = p ? p.name : 'Unknown';
        const typeBadge = e.type === 'SHARED' ? '<span class="badge bg-success">Gasto</span>' : '<span class="badge bg-warning text-dark">Préstamo</span>';

        return {
            date: new Date(e.date).toLocaleDateString(),
            desc: e.desc,
            payer: payerName,
            type: typeBadge,
            amount: '$' + parseFloat(e.amount).toFixed(2),
            id: e.id
        };
    }).reverse();

    initTable('expensesTable', data, [
        { data: 'date' },
        { data: 'desc' },
        { data: 'payer' },
        { data: 'type' },
        { data: 'amount' },
        {
            data: 'id',
            className: 'text-end',
            render: function (id) {
                // Determine permissions again (could be passed down but global access is fine for now)
                const isCreator = currentSessionUser && group.created_by === currentSessionUser.id;
                const isPaid = group.status === 'PAID';

                if (!isCreator || isPaid) {
                    return '<span class="text-muted"><i class="fas fa-lock" title="Solo lectura"></i></span>';
                }
                return `
                    <button class="btn btn-info btn-sm text-white me-1" onclick="openEditExpense(${id})"><i class="fas fa-pencil"></i></button>
                    <button class="btn btn-danger btn-sm text-white" onclick="deleteExpense(${id})"><i class="fas fa-trash"></i></button>
                `;
            }
        }
    ]);
}

// 3. Balances (Calculated locally from fetched expenses)
function renderGroupBalances() {
    const group = AppState.groups.find(g => g.id == currentGroupId);
    const container = $('#balancesContainer');
    container.empty();

    const txs = calculateBalances(group);
    if (txs.length === 0) {
        container.html('<div class="col-12"><div class="alert alert-success text-center">Cuentas saldadas.</div></div>');
        return;
    }

    txs.forEach(t => {
        const fromName = AppState.people.find(p => p.id == t.from)?.name || '?';
        const toName = AppState.people.find(p => p.id == t.to)?.name || '?';

        container.append(`
            <div class="col-md-4">
                <div class="card h-100 border-warning">
                    <div class="card-body text-center">
                        <i class="fas fa-hand-holding-usd fa-2x text-warning mb-2"></i>
                        <h5 class="card-title text-danger">$${t.amount.toFixed(2)}</h5>
                        <p class="card-text">
                            <strong>${fromName}</strong> debe pagar a <strong>${toName}</strong>
                        </p>
                    </div>
                </div>
            </div>
        `);
    });
}

function calculateBalances(group) {
    if (!group || !group.expenses) return [];
    let bals = {};
    (group.memberIds || []).forEach(m => bals[m] = 0);

    group.expenses.forEach(e => {
        const amt = parseFloat(e.amount);
        // Ensure keys are treated as same type (strings/ints)
        const pid = e.payerId;
        bals[pid] = (bals[pid] || 0) + amt;

        if (e.type === 'SHARED') {
            const share = amt / (e.involvedIds || []).length;
            (e.involvedIds || []).forEach(uid => bals[uid] = (bals[uid] || 0) - share);
        } else {
            const bid = e.borrowerId;
            bals[bid] = (bals[bid] || 0) - amt;
        }
    });

    let deb = [], cred = [];
    Object.keys(bals).forEach(k => {
        let v = bals[k];
        if (v < -0.01) deb.push({ id: k, val: v });
        if (v > 0.01) cred.push({ id: k, val: v });
    });
    deb.sort((a, b) => a.val - b.val);
    cred.sort((a, b) => b.val - a.val);

    let txs = [];
    let i = 0, j = 0;
    while (i < deb.length && j < cred.length) {
        let d = deb[i], c = cred[j];
        let amount = Math.min(Math.abs(d.val), c.val);
        amount = Math.round(amount * 100) / 100;

        if (amount > 0) txs.push({ from: d.id, to: c.id, amount: amount });

        d.val += amount; c.val -= amount;
        if (Math.abs(d.val) < 0.01) i++;
        if (Math.abs(c.val) < 0.01) j++;
    }
    return txs;
}

// --- CRUD Expenses ---
let editExpId = null;

function openExpenseModal() {
    const group = AppState.groups.find(g => g.id == currentGroupId);
    if ((group.memberIds || []).length === 0) {
        alert('Agrega integrantes primero'); return;
    }

    editExpId = null; // Reset for new
    $('#expenseModalTitle').text('Nuevo Gasto');
    $('#btnDeleteExp').addClass('d-none');
    $('#expDesc').val('');
    $('#expAmount').val('');

    populateExpSelectors(group);
    $('#expType').val('SHARED').trigger('change');
    new bootstrap.Modal(document.getElementById('expenseModal')).show();
}

function openEditExpense(id) {
    const group = AppState.groups.find(g => g.id == currentGroupId);
    const exp = group.expenses.find(e => e.id == id);
    if (!exp) return;

    editExpId = id;
    $('#expenseModalTitle').text('Editar Gasto');

    // Show delete button in modal if desired, or keep it in table. 
    // In our UI the delete is in the table, but we can have it here too.
    $('#btnDeleteExp').removeClass('d-none');

    $('#expDesc').val(exp.desc);
    $('#expAmount').val(exp.amount);
    populateExpSelectors(group);

    $('#expPayer').val(exp.payerId);
    $('#expType').val(exp.type).trigger('change');

    if (exp.type === 'SHARED') {
        const inv = exp.involvedIds || [];
        $('.split-check').each(function () {
            // Need to convert value to int/string matching
            $(this).prop('checked', inv.includes(parseInt($(this).val())) || inv.includes($(this).val()));
        });
    } else {
        $('#expBorrower').val(exp.borrowerId);
    }
    new bootstrap.Modal(document.getElementById('expenseModal')).show();
}

function populateExpSelectors(group) {
    const payer = $('#expPayer').empty();
    const borrower = $('#expBorrower').empty();
    const checks = $('#expSplitChecks').empty();

    (group.memberIds || []).forEach(mid => {
        const p = AppState.people.find(x => x.id == mid);
        if (p) {
            payer.append(new Option(p.name, p.id));
            borrower.append(new Option(p.name, p.id));
            checks.append(`
                <div class="col-6">
                    <div class="form-check">
                        <input class="form-check-input split-check" type="checkbox" value="${p.id}" id="chk_${p.id}" checked>
                        <label class="form-check-label" for="chk_${p.id}">${p.name}</label>
                    </div>
                </div>
            `);
        }
    });
}

function toggleExpType() {
    const t = $('#expType').val();
    if (t === 'SHARED') {
        $('#expSharedSection').removeClass('d-none');
        $('#expLoanSection').addClass('d-none');
    } else {
        $('#expSharedSection').addClass('d-none');
        $('#expLoanSection').removeClass('d-none');
    }
}

async function saveExpense() {
    const desc = $('#expDesc').val();
    const amount = parseFloat($('#expAmount').val());
    const payer = $('#expPayer').val();
    const type = $('#expType').val();

    // Safety Check: Is Group Paid? OR Not Creator?
    const group = AppState.groups.find(g => g.id == currentGroupId);
    if (group) {
        if (group.status === 'PAID') {
            alert('Este grupo está pagado y cerrado. No se pueden modificar gastos.');
            return;
        }
        if (currentSessionUser && group.created_by !== currentSessionUser.id) {
            alert('Solo el creador del grupo puede modificar gastos.');
            return;
        }
    }

    if (!desc || !amount || !payer) { alert('Datos incompletos'); return; }

    const expensePayload = {
        group_id: currentGroupId,
        payer_id: payer,
        description: desc,
        amount: amount,
        type: type,
        borrower_id: type === 'LOAN' ? $('#expBorrower').val() : null
    };

    let savedId = editExpId;

    if (editExpId) {
        // UPDATE
        const { error: errUpd } = await supabase
            .from('expenses')
            .update(expensePayload)
            .eq('id', editExpId);

        if (errUpd) { alert('Error actualizando'); return; }

        // Update involved: Delete all old, insert new (Simplest strategy)
        if (type === 'SHARED') {
            await supabase.from('expense_involved').delete().eq('expense_id', editExpId);
        } else {
            // If changed from SHARED to LOAN, we must also clear involved
            await supabase.from('expense_involved').delete().eq('expense_id', editExpId);
        }

    } else {
        // INSERT
        const { data: expResult, error: errIns } = await supabase
            .from('expenses')
            .insert([expensePayload])
            .select();

        if (errIns) { alert('Error guardando'); console.log(errIns); return; }
        savedId = expResult[0].id;
    }

    // Insert Involved (Shared)
    if (type === 'SHARED') {
        const inv = [];
        $('.split-check:checked').each(function () { inv.push($(this).val()); });
        if (inv.length === 0) { alert('Selecciona participantes'); return; }

        const invPayload = inv.map(pid => ({ expense_id: savedId, person_id: pid }));
        const { error: errInv } = await supabase.from('expense_involved').insert(invPayload);
        if (errInv) console.log(errInv);
    }

    bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
    await openGroupDetail(currentGroupId);
}

async function deleteExpense(id) {
    if (!id && editExpId) id = editExpId; // Handle delete from modal

    // Safety Check
    const group = AppState.groups.find(g => g.id == currentGroupId);
    if (group) {
        if (group.status === 'PAID') {
            alert('Grupo cerrado. No se puede borrar.');
            return;
        }
        if (currentSessionUser && group.created_by !== currentSessionUser.id) {
            alert('Solo el creador puede eliminar gastos.');
            return;
        }
    }

    if (confirm('¿Borrar?')) {
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) alert('Error borrando');
        else {
            if (bootstrap.Modal.getInstance(document.getElementById('expenseModal'))) {
                bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
            }
            await openGroupDetail(currentGroupId);
        }
    }
}


// --- Settings ---
function openSettingsModal() {
    new bootstrap.Modal(document.getElementById('settingsModal')).show();
}

window.showView = showView;
window.logout = logout;
window.toggleAuthMode = toggleAuthMode;
window.addGlobalPerson = addGlobalPerson;
window.addMemberToGroup = addMemberToGroup;
window.toggleExpType = toggleExpType;
window.saveExpense = saveExpense;
window.openExpenseModal = openExpenseModal;
window.openSettingsModal = openSettingsModal;
window.openGroupDetail = openGroupDetail;
window.deleteGroup = deleteGroup;
window.deleteGlobalPerson = deleteGlobalPerson;
window.toggleGroupStatus = toggleGroupStatus;
window.removeMember = removeMember;
window.deleteExpense = deleteExpense;
window.openEditExpense = openEditExpense;
window.openGroupModal = openGroupModal;
window.saveGroup = saveGroup;