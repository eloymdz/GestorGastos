/**
 * Expense Tracker - Serverless Edition (Supabase)
 */

// --- Supabase Config ---
const SUPABASE_URL = 'https://qcgabxqoqxtdrvugqalr.supabase.co';
const SUPABASE_KEY = 'sb_publishable__OQcd-N-fk5WSAM6eGdxfw_9UB-DPvG'; // Public Anon Key
const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    try {
        await refreshData(); // Initial Fetch
    } catch (e) {
        console.error(e);
    }
    showView('dashboard');
});

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

        // 2. Fetch Groups
        // 2. Fetch Groups (with Expenses Amount for totals)
        const { data: groups, error: errG } = await supabase
            .from('groups')
            .select('*, expenses(amount)'); // Fetch related expenses (amounts only for efficiency)
        if (errG) throw errG;

        // 3. For the simplified UI logic we have, we need to nest expenses and members.
        // In a real large app, we would load strictly on demand. For now, we mimic the old structure slightly
        // or trigger on-demand loading when opening a group. 
        // Let's load mainly the list first.

        AppState.groups = groups.map(g => ({
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

    $('#view-dashboard, #view-groups, #view-people, #view-group-detail').addClass('d-none');

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
        const owner = AppState.people.find(p => p.id == g.owner_id);
        const ownerName = owner ? owner.name : '<span class="text-muted">--</span>';

        // Calculate Total
        const total = g.totalAmount || 0;

        return {
            name: g.name,
            ownerName: ownerName,
            isPublic: g.is_public, // from DB
            status: g.status,
            date: dateStr,
            totalStr: '$' + total.toLocaleString('es-MX', { minimumFractionDigits: 2 }),
            id: g.id
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
            render: function (id, type, row) {
                const toggleTitle = row.status === 'PENDING' ? 'Marcar Pagado' : 'Reabrir (Pendiente)';
                const toggleIcon = row.status === 'PENDING' ? 'fa-check' : 'fa-undo';
                const toggleClass = row.status === 'PENDING' ? 'btn-outline-success' : 'btn-outline-warning';

                return `
                    <button class="btn btn-primary btn-sm me-1" onclick="openGroupDetail(${id})"><i class="fas fa-eye"></i></button>
                    <button class="btn ${toggleClass} btn-sm me-1" title="${toggleTitle}" onclick="toggleGroupStatus(${id}, '${row.status}')"><i class="fas ${toggleIcon}"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="deleteGroup(${id})"><i class="fas fa-trash"></i></button>
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

function openCreateGroupModal() {
    $('#newGroupName').val('');
    $('#newGroupPublic').prop('checked', false);

    // Populate Owner Select
    const s = $('#newGroupOwner').empty();
    s.append('<option value="">-- Selecciona --</option>');
    AppState.people.forEach(p => {
        s.append(new Option(p.name, p.id));
    });

    new bootstrap.Modal(document.getElementById('createGroupModal')).show();
}

async function createGroup() {
    const name = $('#newGroupName').val().trim();
    const ownerId = $('#newGroupOwner').val();
    const isPublic = $('#newGroupPublic').is(':checked');

    if (name) {
        const payload = {
            name: name,
            owner_id: ownerId || null,
            is_public: isPublic
        };

        const { error } = await supabase.from('groups').insert([payload]);
        if (error) alert('Error creando grupo');
        else {
            bootstrap.Modal.getInstance(document.getElementById('createGroupModal')).hide();
            showView('groups');
        }
    } else {
        alert('El nombre es obligatorio');
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
        id: p.id
    }));

    initTable('peopleTable', data, [
        { data: 'name' },
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

    $('#detailGroupName').text(group.name + (group.status === 'PAID' ? ' (Pagado)' : ''));

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
            render: function (id) {
                // Now restored: Edit button
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

window.openGroupDetail = openGroupDetail;
window.deleteGroup = deleteGroup;
window.deleteGlobalPerson = deleteGlobalPerson;
window.toggleGroupStatus = toggleGroupStatus;
window.removeMember = removeMember;
window.deleteExpense = deleteExpense;
window.openEditExpense = openEditExpense;
