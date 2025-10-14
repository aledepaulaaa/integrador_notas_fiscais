const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');
const FILE = path.join(DATA_DIR, 'history.json');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadHistory() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE)) {
            const initialHistory = {
                lastProcessing: null,
                processings: [],
                totalProcessed: {
                    xmls: 0,
                    cnpjs: 0,
                    success: 0,
                    failed: 0
                }
            };
            fs.writeFileSync(FILE, JSON.stringify(initialHistory, null, 2));
            return initialHistory;
        }
        return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        console.error('historyModel.loadHistory error:', e.message);
        return null;
    }
}

function saveHistory(history) {
    try {
        ensureDir();
        fs.writeFileSync(FILE, JSON.stringify(history, null, 2));
        return true;
    } catch (e) {
        console.error('historyModel.saveHistory error:', e.message);
        return false;
    }
}

function addProcessingEntry(entry) {
    const history = loadHistory();
    if (!history) return false;

    const newEntry = {
        ...entry,
        timestamp: new Date().toISOString()
    };

    history.processings.unshift(newEntry); // Adiciona no início do array
    history.lastProcessing = newEntry;

    // Atualiza totais
    history.totalProcessed.xmls += (entry.xmlsProcessed || 0);
    history.totalProcessed.cnpjs += (entry.cnpjsProcessed || 0);
    history.totalProcessed.success += (entry.success || 0);
    history.totalProcessed.failed += (entry.failed || 0);

    // Mantém apenas os últimos 100 registros
    if (history.processings.length > 100) {
        history.processings = history.processings.slice(0, 100);
    }

    return saveHistory(history);
}

module.exports = {
    loadHistory,
    saveHistory,
    addProcessingEntry
};