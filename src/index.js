// src/index.js
const express = require("express")
const path = require("path")
const bodyParser = require("body-parser")
const config = require("./config")
const cron = require("node-cron")
const siegService = require("./services/siegService")
const nfService = require("./services/nfstockService")
const cnpjModel = require("./models/cnpjModel")
const statusModel = require("./models/statusModel")
const apiController = require("./controllers/apiController")

const app = express()
app.use(bodyParser.json())
app.use("/public", express.static(path.join(__dirname, "views", "public")))
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views", "index.html")))

app.use("/api", apiController.router)

function simpleLog(m) { console.log(`[${new Date().toLocaleString("pt-BR")}] ${m}`) }

// Variável para armazenar a tarefa agendada
let scheduledTask = null

// função para agendar a rotina.
function scheduleProcessing() {
    // Agendar a rotina para rodar a cada 4 horas
    scheduledTask = cron.schedule("0 */4 * * *", async () => {
        simpleLog("Iniciando rotina de processamento agendada...")

        // Crie o dateRange para a busca. Sugestão: buscar notas dos últimos 30 dias.
        const today = new Date()
        const thirtyDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)

        const dateRange = {
            startDate: thirtyDaysAgo.toISOString().split("T")[0],
            endDate: today.toISOString().split("T")[0]
        }

        const allCnpjs = cnpjModel.loadAll().map(c => c.cnpj)
        await rotinaCompleta(allCnpjs, dateRange)
    })
    simpleLog("Rotina agendada para rodar a cada 4 horas.")
}

// função para parar a rotina
function stopProcessing() {
    if (scheduledTask) {
        scheduledTask.stop()
        scheduledTask = null
        simpleLog("Rotina agendada parada.")
        apiController.setState({
            isProcessing: false,
            statusMessage: "Rotina automática parada. Aguardando ação manual."
        })
    }
}


async function processCnpjEntry(entry, dateRange) {
    const { cnpj } = entry
    simpleLog(`Processando CNPJ ${cnpj}...`)
    apiController.setState({ currentCnpj: cnpj, statusMessage: `Contando notas para ${cnpj}...`, isProcessing: true })

    try {
        const startISO = new Date(dateRange.startDate).toISOString()
        const endISO = new Date(dateRange.endDate + "T23:59:59.999Z").toISOString()

        const totalNotasContadas = await siegService.contarNotas({ cnpj, startISO, endISO })

        apiController.setState({ statusMessage: `Total encontrado ${totalNotasContadas} notas para ${cnpj}.` })

        if (totalNotasContadas === 0) {
            simpleLog(`Nenhuma nota nova encontrada para ${cnpj} no período.`)
            cnpjModel.updateChecked(cnpj, new Date().toISOString(), { found: 0 })
            return { total: 0, sent: 0, failed: 0, skipped: 0 }
        }

        apiController.setState({ statusMessage: `Baixando ${totalNotasContadas} notas para ${cnpj}...` })

        const notasBaixadas = await siegService.baixarNotas({ cnpj, startISO, endISO, total: totalNotasContadas })

        cnpjModel.updateChecked(cnpj, new Date().toISOString(), { found: notasBaixadas.length })
        apiController.setState({ statusMessage: `Baixadas ${notasBaixadas.length} de ${totalNotasContadas} notas para ${cnpj}.` })
        apiController.setState({ statusMessage: `Enviando ${notasBaixadas.length} notas para NF-Stock...` })
        const envioResultado = await nfService.uploadAll(notasBaixadas)

        simpleLog(`CNPJ ${cnpj} finalizado. Contadas: ${totalNotasContadas}, Baixadas: ${notasBaixadas.length}, Enviadas: ${envioResultado.sent}, Falhas: ${envioResultado.failed}, Puladas: ${envioResultado.skipped}`)
        apiController.setState({ statusMessage: `Finalizado envio para ${cnpj}: ${envioResultado.sent} enviados, ${envioResultado.failed} falhas.` })

        return {
            total: totalNotasContadas,
            sent: envioResultado.sent,
            failed: envioResultado.failed,
            skipped: envioResultado.skipped + (totalNotasContadas - notasBaixadas.length)
        }

    } catch (error) {
        simpleLog(`Erro crítico ao processar CNPJ ${cnpj}: ${error.message}`)
        cnpjModel.updateError(cnpj, error.message)
        cnpjModel.incrementProcessCount(cnpj)
        apiController.setState({ statusMessage: `Erro ao processar ${cnpj}: ${error.message}` })
        throw error
    }
}

// O resto do arquivo (rotinaCompleta, app.listen, etc.) permanece exatamente o mesmo.
async function rotinaCompleta(cnpjsToProcess, dateRange) {
    const state = apiController.getState()
    if (state.isProcessing) {
        simpleLog("Rotina já em andamento. Nova execução ignorada.")
        return
    }

    if (!cnpjsToProcess || !dateRange) {
        simpleLog("Tentativa de iniciar rotina sem parâmetros. Ignorando.")
        return
    }

    apiController.setState({ isProcessing: true, statusMessage: "Iniciando rotina de integração...", progress: 0 })
    simpleLog("================ INICIANDO ROTINA DE INTEGRAÇÃO ================")

    const cnpjs = cnpjModel.loadAll().filter(c => cnpjsToProcess.includes(c.cnpj))
    if (cnpjs.length === 0) {
        simpleLog("Nenhum dos CNPJs selecionados foi encontrado na lista. Finalizando rotina.")
        apiController.setState({ isProcessing: false, statusMessage: "Ocioso. Nenhum CNPJ válido selecionado." })
        return
    }

    const globalSummary = { found: 0, sent: 0, failed: 0, skipped: 0, processedCnpjs: 0 }
    let cnpjsComFalha = 0

    for (let i = 0; i < cnpjs.length; i++) {
        const entry = cnpjs[i]
        apiController.setState({ currentCnpj: entry.cnpj, statusMessage: `Processando ${entry.cnpj} (${i + 1}/${cnpjs.length})` })

        if ((entry.processCount || 0) >= 3) {
            simpleLog(`CNPJ ${entry.cnpj} pulado devido a falhas repetidas.`)
            globalSummary.skipped += (entry.lastResult?.found || 0)
            cnpjsComFalha++
            continue
        }

        try {
            const r = await processCnpjEntry(entry, dateRange)
            globalSummary.found += r.total || 0
            globalSummary.sent += r.sent || 0
            globalSummary.failed += r.failed || 0
            globalSummary.skipped += r.skipped || 0
        } catch (e) {
            cnpjsComFalha++
            simpleLog(`Erro no processamento do CNPJ ${entry.cnpj}: ${e.message}`)
        }

        globalSummary.processedCnpjs++
        apiController.setState({ progress: Math.round(((i + 1) / cnpjs.length) * 100) })
    }

    const statusObj = { lastRun: new Date().toISOString(), summary: globalSummary }
    statusModel.saveStatus(statusObj)

    // Adiciona entrada no histórico
    const historyEntry = {
        date: new Date().toISOString(),
        cnpjsProcessed: globalSummary.processedCnpjs,
        xmlsProcessed: globalSummary.found,
        success: globalSummary.sent,
        failed: globalSummary.failed,
        skipped: globalSummary.skipped,
        cnpjsWithErrors: cnpjsComFalha,
        dateRange
    };

    const historyModel = require('./models/historyModel');
    historyModel.addProcessingEntry(historyEntry);

    simpleLog(`Resumo: ${JSON.stringify(globalSummary)}`)
    simpleLog("================ ROTINA FINALIZADA ================")

    apiController.setState({
        isProcessing: false,
        progress: 0,
        currentCnpj: "",
        statusMessage: cnpjsComFalha > 0 ? `Finalizada com ${cnpjsComFalha} CNPJ(s) com erro.` : "Finalizada com sucesso."
    })
}

module.exports.triggerRotina = rotinaCompleta

apiController.router.post("/stop-schedule", (req, res) => {
    stopProcessing()
    res.json({ success: true, message: "Processamento agendado foi parado." })
})

app.listen(config.PORT, () => {
    simpleLog(`Servidor iniciado na porta ${config.PORT}`)
    simpleLog("Aguardando ações do usuário para iniciar o processamento.")
    scheduleProcessing() // Inicia a rotina agendada quando o servidor for iniciado
})