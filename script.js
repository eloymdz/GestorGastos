/**
 * Expense Tracker - Responsive & Status Edition
 */

// --- State ---
const DEFAULT_STATE = { people: [], groups: [] };
let AppState = JSON.parse(localStorage.getItem('expenseTrackerState')) || DEFAULT_STATE;
let currentGroupId = null;

// --- DataTables Instances ---
let tables = {};

// --- Initialization ---
$(document).ready(function () {
    migrateData();
    initLayout();
    showView('dashboard');
});

function initLayout() {
    $("#menu-toggle").click(function (e) {
        e.preventDefault();
        $("body").toggleClass("sb-sidenav-toggled");
    });
}

function migrateData() {
    let dirty = false;
    if (!AppState.people) { AppState.people = []; dirty = true; }
    if (!AppState.groups) { AppState.groups = []; dirty = true; }

    AppState.groups.forEach(g => {
        // v4 migration: embedded people
        if (g.people && g.people.length > 0) {
            if (!g.memberIds) g.memberIds = [];
            g.people.forEach(lx => {
                let gp = AppState.people.find(x => x.id === lx.id || x.name === lx.name);
                if (!gp) {
                    gp = { id: lx.id || Date.now().toString(), name: lx.name };
                    AppState.people.push(gp);
                }
                if (!g.memberIds.includes(gp.id)) g.memberIds.push(gp.id);
            });
            delete g.people;
            dirty = true;
        }

        // v6 migration: status and timestamps
        if (!g.status) { g.status = 'PENDING'; dirty = true; }
        if (!g.createdAt) { g.createdAt = Date.now(); dirty = true; } // Backfill with now for old groups
        if (!g.paidAt) { g.paidAt = null; dirty = true; }
    });

    if (dirty) saveState();
}

function saveState() {
    localStorage.setItem('expenseTrackerState', JSON.stringify(AppState));
}

// --- View Navigation ---
function showView(viewName) {
    $('.list-group-item').removeClass('active');
    $(`#nav-${viewName}`).addClass('active');

    $('#view-dashboard, #view-groups, #view-people, #view-group-detail').addClass('d-none');

    if (viewName === 'dashboard') {
        $('#view-dashboard').removeClass('d-none');
        renderDashboard();
    } else if (viewName === 'groups') {
        $('#view-groups').removeClass('d-none');
        renderGroupsTable();
    } else if (viewName === 'people') {
        $('#view-people').removeClass('d-none');
        renderPeopleTable();
    }
}

// --- Helper for DataTable ---
function initTable(id, data, columns, createdRowCallback = null) {
    if ($.fn.DataTable.isDataTable('#' + id)) {
        $('#' + id).DataTable().destroy(); // destroy old instance
    }

    tables[id] = $('#' + id).DataTable({
        data: data,
        columns: columns,
        responsive: true, // Enable Responsive
        language: {
            url: "//cdn.datatables.net/plug-ins/1.13.4/i18n/es-ES.json"
        },
        createdRow: createdRowCallback
    });
}

// --- Dashboard ---
function renderDashboard() {
    const active = AppState.groups.filter(g => g.status === 'PENDING').length;
    $('#dash-total-groups').text(active);
    $('#dash-total-people').text(AppState.people.length);

    // Recent groups (PENDING only or all? Let's show all but sort pending first)
    const data = AppState.groups.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(g => ({
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
                return `<button class="btn btn-sm btn-primary" onclick="openGroupDetail('${data}')">Ver</button>`;
            }
        }
    ]);
}

// --- Groups List ---
function renderGroupsTable() {
    const data = AppState.groups.map(g => {
        const total = (g.expenses || []).reduce((acc, c) => acc + parseFloat(c.amount), 0);
        let dateStr = new Date(g.createdAt).toLocaleDateString();
        if (g.status === 'PAID' && g.paidAt) {
            dateStr = 'Pagado: ' + new Date(g.paidAt).toLocaleDateString();
        }

        return {
            name: g.name,
            status: g.status,
            date: dateStr,
            total: total,
            totalStr: '$' + total.toLocaleString('es-MX', { minimumFractionDigits: 2 }),
            id: g.id
        };
    });

    initTable('groupsTable', data, [
        { data: 'name' },
        {
            data: 'status',
            render: function (s) {
                return s === 'PAID'
                    ? '<span class="badge bg-success">Pagado</span>'
                    : '<span class="badge bg-warning text-dark">Pendiente</span>';
            }
        },
        { data: 'date' },
        { data: 'totalStr', orderData: [3] },
        {
            data: 'id',
            render: function (id, type, row) {
                const toggleTitle = row.status === 'PENDING' ? 'Marcar Pagado' : 'Reabrir (Pendiente)';
                const toggleIcon = row.status === 'PENDING' ? 'fa-check' : 'fa-undo';
                const toggleClass = row.status === 'PENDING' ? 'btn-outline-success' : 'btn-outline-warning';

                return `
                    <button class="btn btn-primary btn-sm me-1" onclick="openGroupDetail('${id}')"><i class="fas fa-eye"></i></button>
                    <button class="btn ${toggleClass} btn-sm me-1" title="${toggleTitle}" onclick="toggleGroupStatus('${id}')"><i class="fas ${toggleIcon}"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="deleteGroup('${id}')"><i class="fas fa-trash"></i></button>
                `;
            }
        }
    ]);
}

function toggleGroupStatus(id) {
    const g = AppState.groups.find(x => x.id === id);
    if (g) {
        if (g.status === 'PENDING') {
            if (confirm('¿Marcar grupo como PAGADO?')) {
                g.status = 'PAID';
                g.paidAt = Date.now();
            }
        } else {
            g.status = 'PENDING';
            g.paidAt = null;
        }
        saveState();
        renderGroupsTable();
    }
}

function openCreateGroupModal() {
    $('#newGroupName').val('');
    new bootstrap.Modal(document.getElementById('createGroupModal')).show();
}

function createGroup() {
    const name = $('#newGroupName').val().trim();
    if (name) {
        AppState.groups.push({
            id: Date.now().toString(),
            name,
            memberIds: [],
            expenses: [],
            status: 'PENDING',
            createdAt: Date.now(),
            paidAt: null
        });
        saveState();
        bootstrap.Modal.getInstance(document.getElementById('createGroupModal')).hide();
        renderGroupsTable();
    }
}

function deleteGroup(id) {
    if (confirm('¿Eliminar grupo permanentemente?')) {
        AppState.groups = AppState.groups.filter(g => g.id !== id);
        saveState();
        renderGroupsTable();
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
                return `<button class="btn btn-danger btn-sm" onclick="deleteGlobalPerson('${id}')"><i class="fas fa-trash"></i></button>`;
            }
        }
    ]);
}

function addGlobalPerson() {
    const name = $('#globalPersonName').val().trim();
    if (name) {
        AppState.people.push({ id: Date.now().toString(), name });
        saveState();
        $('#globalPersonName').val('');
        renderPeopleTable();
        alert('Persona agregada');
    }
}

function deleteGlobalPerson(id) {
    if (confirm('¿Eliminar del directorio global?')) {
        AppState.people = AppState.people.filter(p => p.id !== id);
        saveState();
        renderPeopleTable();
    }
}

// --- Group Detail ---
function openGroupDetail(id) {
    currentGroupId = id;
    const group = AppState.groups.find(g => g.id === id);
    if (!group) return;

    $('#detailGroupName').text(group.name + (group.status === 'PAID' ? ' (Pagado)' : ''));

    // Switch view
    $('#view-dashboard, #view-groups, #view-people, #view-group-detail').addClass('d-none');
    $('#view-group-detail').removeClass('d-none');

    // Set active tab to Expenses
    var firstTabEl = document.querySelector('#view-group-detail .nav-link[href="#tab-expenses"]')
    var firstTab = new bootstrap.Tab(firstTabEl)
    firstTab.show()

    renderGroupExpenses();
    renderGroupBalances();
    renderGroupMembers();
}

// 1. Members
function renderGroupMembers() {
    const group = AppState.groups.find(g => g.id === currentGroupId);
    const list = $('#groupMembersList');
    list.empty();

    (group.memberIds || []).forEach(mid => {
        const p = AppState.people.find(x => x.id === mid);
        if (p) {
            list.append(`
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    ${p.name}
                    <button class="btn btn-sm btn-outline-danger" onclick="removeMember('${mid}')"><i class="fas fa-times"></i></button>
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

function addMemberToGroup() {
    const pid = $('#selectPersonToAdd').val();
    if (!pid) return;
    const group = AppState.groups.find(g => g.id === currentGroupId);
    if (!group.memberIds) group.memberIds = [];
    group.memberIds.push(pid);
    saveState();
    renderGroupMembers();
}

function removeMember(mid) {
    if (confirm('¿Quitar del grupo?')) {
        const group = AppState.groups.find(g => g.id === currentGroupId);
        group.memberIds = group.memberIds.filter(id => id !== mid);
        saveState();
        renderGroupMembers();
    }
}

// 2. Expenses
function renderGroupExpenses() {
    const group = AppState.groups.find(g => g.id === currentGroupId);
    const data = (group.expenses || []).map(e => {
        const p = AppState.people.find(x => x.id === e.payerId);
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
                return `<button class="btn btn-info btn-sm text-white" onclick="openEditExpense('${id}')"><i class="fas fa-pencil"></i></button>`;
            }
        }
    ]);
}

// 3. Balances
function renderGroupBalances() {
    const group = AppState.groups.find(g => g.id === currentGroupId);
    const container = $('#balancesContainer');
    container.empty();

    const txs = calculateBalances(group);
    if (txs.length === 0) {
        container.html('<div class="col-12"><div class="alert alert-success text-center">Cuentas saldadas.</div></div>');
        return;
    }

    txs.forEach(t => {
        const fromName = AppState.people.find(p => p.id === t.from)?.name || '?';
        const toName = AppState.people.find(p => p.id === t.to)?.name || '?';

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
        bals[e.payerId] = (bals[e.payerId] || 0) + amt;
        if (e.type === 'SHARED') {
            const share = amt / (e.involvedIds || []).length;
            (e.involvedIds || []).forEach(uid => bals[uid] = (bals[uid] || 0) - share);
        } else {
            bals[e.borrowerId] = (bals[e.borrowerId] || 0) - amt;
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
    const group = AppState.groups.find(g => g.id === currentGroupId);
    if ((group.memberIds || []).length === 0) {
        alert('Agrega integrantes primero'); return;
    }
    editExpId = null;
    $('#expenseModalTitle').text('Nuevo Gasto');
    $('#btnDeleteExp').addClass('d-none');
    $('#expDesc').val('');
    $('#expAmount').val('');

    populateExpSelectors(group);
    $('#expType').val('SHARED').trigger('change');
    new bootstrap.Modal(document.getElementById('expenseModal')).show();
}

function openEditExpense(id) {
    const group = AppState.groups.find(g => g.id === currentGroupId);
    const exp = group.expenses.find(e => e.id === id);
    if (!exp) return;

    editExpId = id;
    $('#expenseModalTitle').text('Editar Gasto');
    $('#btnDeleteExp').removeClass('d-none');

    $('#expDesc').val(exp.desc);
    $('#expAmount').val(exp.amount);
    populateExpSelectors(group);

    $('#expPayer').val(exp.payerId);
    $('#expType').val(exp.type).trigger('change');

    if (exp.type === 'SHARED') {
        const inv = exp.involvedIds || [];
        $('.split-check').each(function () {
            $(this).prop('checked', inv.includes($(this).val()));
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
        const p = AppState.people.find(x => x.id === mid);
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

function saveExpense() {
    const desc = $('#expDesc').val();
    const amount = parseFloat($('#expAmount').val());
    const payer = $('#expPayer').val();
    const type = $('#expType').val();

    if (!desc || !amount || !payer) { alert('Datos incompletos'); return; }

    const obj = {
        id: editExpId || Date.now().toString(),
        desc, amount, payerId: payer, type,
        date: new Date().toISOString()
    };

    if (type === 'SHARED') {
        const inv = [];
        $('.split-check:checked').each(function () { inv.push($(this).val()); });
        if (inv.length === 0) { alert('Selecciona participantes'); return; }
        obj.involvedIds = inv;
    } else {
        obj.borrowerId = $('#expBorrower').val();
    }

    const group = AppState.groups.find(g => g.id === currentGroupId);
    if (editExpId) {
        const idx = group.expenses.findIndex(e => e.id === editExpId);
        if (idx !== -1) group.expenses[idx] = obj;
    } else {
        group.expenses.push(obj);
    }
    saveState();
    bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
    renderGroupExpenses();
    renderGroupBalances();
}

function deleteExpense() {
    if (confirm('¿Borrar?')) {
        const group = AppState.groups.find(g => g.id === currentGroupId);
        group.expenses = group.expenses.filter(e => e.id !== editExpId);
        saveState();
        bootstrap.Modal.getInstance(document.getElementById('expenseModal')).hide();
        renderGroupExpenses();
        renderGroupBalances();
    }
}

// --- Settings ---
function openSettingsModal() {
    new bootstrap.Modal(document.getElementById('settingsModal')).show();
}
function exportData() {
    const s = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(AppState));
    const a = document.createElement('a'); a.href = s; a.download = "gastos_bkp.json";
    document.body.appendChild(a); a.click(); a.remove();
}
function importData(input) {
    if (!input.files[0]) return;
    const r = new FileReader();
    r.onload = e => {
        try { AppState = JSON.parse(e.target.result); saveState(); location.reload(); }
        catch (x) { alert('Error'); }
    };
    r.readAsText(input.files[0]);
}

window.openGroupDetail = openGroupDetail;
window.deleteGroup = deleteGroup;
window.deleteGlobalPerson = deleteGlobalPerson;
window.openEditExpense = openEditExpense;
window.toggleGroupStatus = toggleGroupStatus; // Exporting new function
