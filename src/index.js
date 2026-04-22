// src/index.js
const express = require("express")
const path = require("path")
const fs = require("fs")
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

const LOG_FILE = path.join(config.DATA_DIR, 'server.log')

function simpleLog(m) { 
    const msg = `[${new Date().toLocaleString("pt-BR")}] ${m}`
    console.log(msg)
    // Escrever também em arquivo
    fs.appendFileSync(LOG_FILE, msg + '\n', { flag: 'a' })
}

// Variável para armazenar a tarefa agendada
let scheduledTask = null

// função para agendar a rotina.
function scheduleProcessing() {
    // Agendar a rotina para rodar a cada 4 horas
    scheduledTask = cron.schedule("0 */4 * * *", async () => {
        simpleLog("Iniciando rotina de processamento agendada...")

        // Crie o dateRange para a busca. Usar range maior para evitar problemas com a API
        const today = new Date()
        // Usar desde o início do ano em vez de apenas 30 dias
        const startOfYear = new Date(today.getFullYear(), 0, 1)

        const dateRange = {
            startDate: startOfYear.toISOString().split("T")[0],
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


// Função principal de processamento - baseada no padrão do EXEMPLO-USO.js da SIEG
async function processarNotasFiscais(cnpj, dataInicio, dataFim) {
    simpleLog(`Processando notas para CNPJ: ${cnpj}`)
    simpleLog(`Período: ${dataInicio} a ${dataFim}`)
    
    try {
        // 1. Contar quantas notas existem no período
        simpleLog('1. Contando notas...')
        apiController.setState({ statusMessage: `Contando notas para ${cnpj}...` })
        
        const totalNotasContadas = await siegService.contarNotas({
            cnpj: cnpj,
            startISO: dataInicio,
            endISO: dataFim
        })
        
        simpleLog(`Encontradas ${totalNotasContadas} notas no período`)
        apiController.setState({ statusMessage: `Total encontrado ${totalNotasContadas} notas para ${cnpj}.` })
        
        if (totalNotasContadas === 0) {
            simpleLog(`Nenhuma nota encontrada para ${cnpj}`)
            cnpjModel.updateChecked(cnpj, new Date().toISOString(), { found: 0 })
            return { found: 0, sent: 0, failed: 0, skipped: 0 }
        }
        
        // 2. Baixar todas as notas
        simpleLog('2. Baixando XMLs...')
        apiController.setState({ statusMessage: `Baixando ${totalNotasContadas} notas para ${cnpj}...` })
        
        const xmls = await siegService.baixarNotas({
            cnpj: cnpj,
            startISO: dataInicio,
            endISO: dataFim,
            total: totalNotasContadas
        })
        
        simpleLog(`Download concluído: ${xmls.length} XMLs baixados`)
        cnpjModel.updateChecked(cnpj, new Date().toISOString(), { found: xmls.length })
        
        // 3. Processar os XMLs baixados
        const notasProcessadas = xmls.map(xml => ({
            chave: xml.chave,
            xml: xml.xml
        }))
        
        // 4. Enviar para NF-Stock (se houver XMLs)
        if (notasProcessadas.length > 0) {
            simpleLog(`4. Enviando ${notasProcessadas.length} XMLs para NF-Stock...`)
            apiController.setState({ statusMessage: `Enviando ${notasProcessadas.length} notas para NF-Stock...` })
            
            try {
                const resultado = await nfService.uploadAll(notasProcessadas)
                simpleLog(`Upload NF-Stock: ${resultado.sent} enviados, ${resultado.failed} falhas, ${resultado.skipped} pulados`)
                apiController.setState({ statusMessage: `Finalizado envio para ${cnpj}: ${resultado.sent} enviados.` })
                
                return {
                    found: totalNotasContadas,
                    sent: resultado.sent,
                    failed: resultado.failed,
                    skipped: resultado.skipped
                }
                
            } catch (uploadError) {
                simpleLog(`Erro no upload para NF-Stock: ${uploadError.message}`)
                // Não falha o processo inteiro se as notas já foram baixadas
                return {
                    found: totalNotasContadas,
                    sent: 0,
                    failed: notasProcessadas.length,
                    skipped: 0,
                    uploadError: uploadError.message
                }
            }
        }
        
        return { found: totalNotasContadas, sent: 0, failed: 0, skipped: 0 }
        
    } catch (error) {
        simpleLog(`Erro ao processar CNPJ ${cnpj}: ${error.message}`)
        cnpjModel.updateError(cnpj, error.message)
        cnpjModel.incrementProcessCount(cnpj)
        apiController.setState({ statusMessage: `Erro ao processar ${cnpj}: ${error.message}` })
        throw error
    }
}

// O resto do arquivo (rotinaCompleta, app.listen, etc.) permanece exatamente o mesmo.
async function rotinaCompleta(cnpjsToProcess, dateRange) {
    simpleLog("================ INICIANDO ROTINA DE INTEGRAÇÃO ================")
    
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
        const { cnpj } = entry
        const startISO = new Date(dateRange.startDate).toISOString()
        const endISO = new Date(dateRange.endDate + "T23:59:59.000Z").toISOString()
        
        apiController.setState({ 
            currentCnpj: cnpj, 
            statusMessage: `Processando ${cnpj} (${i + 1}/${cnpjs.length})`,
            progress: Math.round(((i) / cnpjs.length) * 100)
        })

        if ((entry.processCount || 0) >= 3) {
            simpleLog(`CNPJ ${cnpj} pulado devido a falhas repetidas.`)
            globalSummary.skipped += (entry.lastResult?.found || 0)
            cnpjsComFalha++
            continue
        }

        try {
            const resultado = await processarNotasFiscais(cnpj, startISO, endISO)
            globalSummary.found += resultado.found || 0
            globalSummary.sent += resultado.sent || 0
            globalSummary.failed += resultado.failed || 0
            globalSummary.skipped += resultado.skipped || 0
        } catch (e) {
            cnpjsComFalha++
            simpleLog(`Erro no processamento do CNPJ ${cnpj}: ${e.message}`)
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
    }

    const historyModel = require('./models/historyModel')
    historyModel.addProcessingEntry(historyEntry)

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