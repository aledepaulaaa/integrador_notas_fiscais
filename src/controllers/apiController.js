// src/controllers/apiController.js
const express = require('express');
const router = express.Router();
const cnpjModel = require('../models/cnpjModel');
const statusModel = require('../models/statusModel');
const processedModel = require('../models/processedModel');
const historyModel = require('../models/historyModel');

const processingState = {
    isProcessing: false,
    progress: 0,
    currentCnpj: '',
    statusMessage: 'Ocioso'
};

router.get('/history', (req, res) => {
    try {
        const history = historyModel.loadHistory();
        res.json({ ok: true, history });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Erro ao carregar histórico.' });
    }
});

router.get('/cnpjs', (req, res) => {
    try {
        const list = cnpjModel.loadAll();
        res.json({ ok: true, cnpjs: list });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Erro ao ler a lista de CNPJs.' });
    }
});

router.post('/cnpjs', (req, res) => {
    try {
        const cnpj = req.body?.cnpj;
        if (!cnpj) return res.status(400).json({ ok: false, message: 'CNPJ é obrigatório.' });
        const added = cnpjModel.addCnpj(cnpj);
        if (!added) return res.status(409).json({ ok: false, message: 'CNPJ já existe.' });
        res.status(201).json({ ok: true, cnpj: added.cnpj });
    } catch (e) {
        res.status(400).json({ ok: false, message: e.message });
    }
});

router.delete('/cnpjs', (req, res) => {
    try {
        const cnpjs = req.body?.cnpjs;
        if (!Array.isArray(cnpjs) || cnpjs.length === 0) {
            return res.status(400).json({ ok: false, message: 'Array de CNPJs é obrigatório.' });
        }
        cnpjModel.deleteMultipleCnpjs(cnpjs);
        res.json({ ok: true, message: `${cnpjs.length} CNPJ(s) excluído(s).` });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

router.get('/status', (req, res) => {
    try {
        const staticStatus = statusModel.loadStatus();
        res.json({
            ok: true,
            status: staticStatus,
            state: processingState
        });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Erro ao carregar o status.' });
    }
});

router.get('/logs', (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const logFile = require('../config').DATA_DIR + '/server.log';
        
        if (!fs.existsSync(logFile)) {
            return res.json({ ok: true, logs: [], message: 'Nenhum log gerado ainda.' });
        }
        
        const content = fs.readFileSync(logFile, 'utf-8');
        const logs = content.split('\n').filter(line => line.trim() !== '');
        
        res.json({ ok: true, logs: logs });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Erro ao ler logs: ' + e.message });
    }
});

// Rota para limpar logs
router.post('/logs/clear', (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const logFile = require('../config').DATA_DIR + '/server.log';
        
        fs.writeFileSync(logFile, '', 'utf-8');
        res.json({ ok: true, message: 'Logs limpos.' });
    } catch (e) {
        res.status(500).json({ ok: false, message: 'Erro ao limpar logs: ' + e.message });
    }
});

router.post('/process', (req, res) => {
    console.log('[ROTA] POST /api/process recebida');
    try {
        const { cnpjs, startDate, endDate } = req.body;
        console.log('[ROTA] Body recebido:', { cnpjs, startDate, endDate });
        
        if (!cnpjs || !Array.isArray(cnpjs) || cnpjs.length === 0) {
            return res.status(400).json({ ok: false, message: 'Selecione ao menos um CNPJ.' });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ ok: false, message: 'Datas de início e fim são obrigatórias.' });
        }
        
        console.log('[ROTA] Parâmetros válidos. Iniciando triggerRotina...');
        const { triggerRotina } = require('../index');
        
        // NÃO aguardar aqui para responder rápido ao usuário
        // Mas executar a função em background com tratamento de erro
        triggerRotina(cnpjs, { startDate, endDate }).catch(err => {
            console.error('[ERRO NÃO TRATADO] Erro durante processamento:', err.message);
        });
        
        console.log('[ROTA] triggerRotina chamada. Enviando resposta ao cliente...');
        res.json({ ok: true, message: 'Processamento iniciado.' });
    } catch (e) {
        console.error('[ROTA] Erro na rota /process:', e.message);
        res.status(500).json({ ok: false, message: e.message });
    }
});

// Rota para resetar os dados
router.post('/reset', (req, res) => {
    try {
        cnpjModel.saveAll([]);
        processedModel.saveSet(new Set());
        statusModel.saveStatus({ lastRun: null, summary: null });
        res.json({ ok: true, message: 'Dados resetados com sucesso.' });
    } catch (e) {
        res.status(500).json({ ok: false, message: e.message });
    }
});

const controller = {
    router,
    setState: (newState) => { Object.assign(processingState, newState); },
    getState: () => ({ ...processingState })
};

module.exports = controller;