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

router.post('/process', (req, res) => {
    try {
        const { cnpjs, startDate, endDate } = req.body;
        if (!cnpjs || !Array.isArray(cnpjs) || cnpjs.length === 0) {
            return res.status(400).json({ ok: false, message: 'Selecione ao menos um CNPJ.' });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ ok: false, message: 'Datas de início e fim são obrigatórias.' });
        }
        const { triggerRotina } = require('../index');
        triggerRotina(cnpjs, { startDate, endDate });
        res.json({ ok: true, message: 'Processamento iniciado.' });
    } catch (e) {
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