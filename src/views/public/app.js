//src/views/public/app.js
(function () {
    // Objeto para centralizar as chamadas de API
    const api = {
        fetchHistory: () => fetch('/api/history').then(handleResponse),
        fetchCnpjs: () => fetch('/api/cnpjs').then(handleResponse),
        addCnpj: (cnpj) => fetch('/api/cnpjs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cnpj }) }).then(handleResponse),
        deleteCnpjs: (arr) => fetch('/api/cnpjs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cnpjs: arr }) }).then(handleResponse),
        startProcess: (cnpjs, startDate, endDate) => fetch('/api/process',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    cnpjs,
                    startDate,
                    endDate
                })
            }).then(handleResponse),
        status: () => fetch('/api/status').then(handleResponse),
        reset: () => fetch('/api/reset', { method: 'POST' }).then(handleResponse),
        stopSchedule: () => fetch('/api/stop-schedule', { method: 'POST' }).then(handleResponse)
    }

    // Função central para tratar respostas da API
    async function handleResponse(response) {
        const data = await response.json()
        if (!response.ok) {
            throw new Error(data.message || 'Erro desconhecido na API')
        }
        return data
    }

    function el(id) { return document.getElementById(id) }

    function showAlert(message, type = 'success') {
        const container = el('globalAlerts')
        const alertId = `alert-${Date.now()}`
        const alertHtml = `<div id="${alertId}" class="alert alert-${type} alert-dismissible fade show" role="alert">${message}<button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button></div>`
        const tempDiv = document.createElement('div')
        tempDiv.innerHTML = alertHtml
        container.appendChild(tempDiv.firstChild)
        setTimeout(() => {
            const alertElement = document.getElementById(alertId)
            if (alertElement && bootstrap.Alert.getOrCreateInstance(alertElement)) {
                bootstrap.Alert.getOrCreateInstance(alertElement).close()
            }
        }, 5000)
    }

    function fmtCnpj(c) {
        if (!c) return ''
        c = c.toString().replace(/\D/g, '')
        if (c.length === 14) return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
        if (c.length === 11) return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
        return c
    }

    function appendLog(text) {
        const box = el('logBox')
        box.innerText = `[${new Date().toLocaleTimeString()}] ${text}\n${box.innerText}`
    }

    async function refreshList() {
        try {
            const data = await api.fetchCnpjs()
            const list = data.cnpjs || []
            const container = el('cnpjList')
            container.innerHTML = ''
            list.forEach(item => {
                const id = item.cnpj
                const row = document.createElement('div')
                row.className = 'list-group-item d-flex align-items-center justify-content-between'
                row.innerHTML = `
                    <div class="form-check">
                        <input type="checkbox" value="${id}" class="form-check-input cnpj-checkbox" id="check-${id}">
                        <label for="check-${id}" class="form-check-label">
                            <strong>${fmtCnpj(id)}</strong>
                            <div class="small text-muted">Último check: ${item.lastChecked ? new Date(item.lastChecked).toLocaleString('pt-BR') : 'Nunca'}</div>
                        </label>
                    </div>
                    <button class="btn btn-sm btn-outline-danger delete-single-btn" data-cnpj="${id}" title="Excluir"><i class="bi bi-trash"></i></button>
                `
                container.appendChild(row)
            })
        } catch (e) {
            showAlert(`Erro ao carregar CNPJs: ${e.message}`, 'danger')
        }
    }

    async function pollStatus() {
        try {
            const s = await api.status()
            el('statusMessage').innerText = s.state?.statusMessage || 'Ocioso'
            const progress = s.state?.progress || 0
            el('progressBar').style.width = progress + '%'
            el('progressBar').innerText = progress + '%'
            const summary = s.status?.summary || {}
            el('chipFound').innerText = 'Encontradas ' + (summary.found || 0)
            el('chipSent').innerText = 'Enviadas ' + (summary.sent || 0)
            el('chipFailed').innerText = 'Falhas ' + (summary.failed || 0)
            el('chipSkipped').innerText = 'Puladas ' + (summary.skipped || 0)
            el('lastSummary').innerText = JSON.stringify(summary, null, 2)
        } catch (e) {
            console.error('Erro no polling de status:', e)
        } finally {
            setTimeout(pollStatus, 3000)
        }
    }

    // Event Listeners
    el('addCnpjBtn').addEventListener('click', async () => {
        const input = el('cnpjInput')
        const v = input.value.trim()
        if (!v) return showAlert('Informe um CNPJ.', 'warning')
        try {
            const res = await api.addCnpj(v)
            appendLog('CNPJ adicionado: ' + fmtCnpj(res.cnpj))
            input.value = ''
            refreshList()
        } catch (e) {
            showAlert(e.message, 'danger')
        }
    })

    el('processBtn').addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.cnpj-checkbox:checked')).map(i => i.value)
        if (checked.length === 0) return showAlert('Selecione ao menos um CNPJ na lista.', 'warning')
        const startDate = el('startDate').value
        const endDate = el('endDate').value
        if (!startDate || !endDate) return showAlert('Informe data início/fim.', 'warning')
        appendLog(`Iniciando processamento para: ${checked.length} CNPJ(s).`)
        try {
            const res = await api.startProcess(checked, startDate, endDate)
            appendLog('Processamento disparado: ' + res.message)
        } catch (e) {
            showAlert(e.message, 'danger')
        }
    })

    el('cnpjList').addEventListener('click', async (e) => {
        const btn = e.target.closest('.delete-single-btn')
        if (btn) {
            const cnpj = btn.dataset.cnpj
            if (confirm(`Tem certeza que deseja excluir o CNPJ ${fmtCnpj(cnpj)}?`)) {
                try {
                    await api.deleteCnpjs([cnpj])
                    showAlert('CNPJ excluído.', 'success')
                    refreshList()
                } catch (e) { showAlert(e.message, 'danger') }
            }
        }
    })

    el('deleteSelectedBtn').addEventListener('click', async () => {
        const checked = Array.from(document.querySelectorAll('.cnpj-checkbox:checked')).map(i => i.value)
        if (checked.length === 0) return showAlert('Nenhum CNPJ selecionado.', 'warning')
        if (confirm(`Tem certeza que deseja excluir os ${checked.length} CNPJs selecionados?`)) {
            try {
                await api.deleteCnpjs(checked)
                showAlert(`${checked.length} CNPJ(s) excluídos.`, 'success')
                refreshList()
            } catch (e) { showAlert(e.message, 'danger') }
        }
    })

    el('selectAllCheckbox').addEventListener('change', (e) => {
        document.querySelectorAll('.cnpj-checkbox').forEach(cb => cb.checked = e.target.checked)
    })

    el('resetDataBtn').addEventListener('click', async () => {
        if (confirm('ATENÇÃO!\nIsso irá apagar TODA a lista de CNPJs e o histórico de notas processadas. Deseja continuar?')) {
            try {
                await api.reset()
                showAlert('Dados da aplicação resetados com sucesso!', 'success')
                refreshList()
                setTimeout(pollStatus, 100)
            } catch (e) { showAlert(e.message, 'danger') }
        }
    })

    el('clearLog').addEventListener('click', () => { el('logBox').innerText = '' })

    // Event Listener para o novo botão
    el('stopAutoBtn').addEventListener('click', async () => {
        if (confirm('Deseja parar o processamento automático agendado? O servidor continuará online, mas a rotina só rodará manualmente.')) {
            try {
                await api.stopSchedule();
                showAlert('Processamento automático parado com sucesso!', 'info')
                appendLog('Processamento automático parado por ação do usuário.')
            } catch (e) {
                showAlert(e.message, 'danger')
            }
        }
    })

    async function refreshHistory() {
        try {
            const data = await api.fetchHistory();
            const history = data.history?.processings || [];
            const tbody = el('historyTable');
            tbody.innerHTML = '';

            history.forEach(entry => {
                const row = document.createElement('tr');
                row.innerHTML = `
                <td>${new Date(entry.date).toLocaleString('pt-BR')}</td>
                <td>${entry.cnpjsProcessed}</td>
                <td>${entry.xmlsProcessed}</td>
                <td class="text-success">${entry.success}</td>
                <td class="text-danger">${entry.failed}</td>
                <td class="text-warning">${entry.skipped}</td>
                <td>${entry.cnpjsWithErrors}</td>
            `;
                tbody.appendChild(row);
            });
        } catch (e) {
            console.error('Erro ao carregar histórico:', e);
        }
    }

    // Função de inicialização
    (function init() {
        const today = new Date()
        const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
        el('startDate').value = iso(new Date(today.getFullYear(), today.getMonth(), 1))
        el('endDate').value = iso(today)
        refreshList()
        pollStatus()
        refreshHistory() // Adicione esta linha
        setInterval(refreshHistory, 30000) // E esta linha para atualizar a cada 30 segundos
    })()
})()