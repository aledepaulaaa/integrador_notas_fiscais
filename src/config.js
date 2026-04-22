// src/config.js
require('dotenv').config();
const path = require('path');

module.exports = {
    // --- Configurações Gerais ---
    PORT: process.env.PORT || 3000,
    TIMEZONE: process.env.TIMEZONE || 'America/Sao_Paulo',

    // --- Agendamento (CRON) ---
    // Padrão: a cada 5 minutos.
    CRON_SCHEDULE: process.env.CRON_SCHEDULE || '*/5 * * * *',

    // --- API da SIEG ---
    SIEG_API_BASE: process.env.SIEG_API_BASE || 'https://api.sieg.com',
    // A chave da API deve ser passada diretamente do .env
    SIEG_API_KEY: process.env.SIEG_API_KEY || '',
    SIEG_CLIENT_ID: process.env.SIEG_CLIENT_ID || '',
    SIEG_SECRET_KEY: process.env.SIEG_SECRET_KEY || '',
    // Quantidade de notas a buscar por página na SIEGE (máximo 50)
    SIEG_PAGE_SIZE: Math.min(50, Number(process.env.SIEG_PAGE_SIZE || 50)),

    // --- API da NF-Stock ---
    NFSTOCK_IMP_BASE: process.env.NFSTOCK_IMP_BASE || 'https://ms-importacao-service-nfstock.alterdatasoftware.com.br',
    // Token fixo (se disponível)
    NFSTOCK_API_TOKEN: process.env.NFSTOCK_API_TOKEN || null,
    // Credenciais para obter token via OAuth (se o token fixo não for fornecido)
    NFSTOCK_AUTH_URL: process.env.NFSTOCK_AUTH_URL || null,
    NFSTOCK_CLIENT_ID: process.env.NFSTOCK_CLIENT_ID || null,
    NFSTOCK_CLIENT_SECRET: process.env.NFSTOCK_CLIENT_SECRET || null,
    // Quantidade de uploads simultâneos para a NF-Stock
    CONCURRENCY_UPLOADS: Number(process.env.CONCURRENCY_UPLOADS || 5),

    // --- Lógica de Negócio ---
    // Período padrão de busca, caso não seja especificado de outra forma
    DATA_INICIO: process.env.DATA_INICIO || '2022-01-01T00:00:00.000Z',
    DATA_FIM: process.env.DATA_FIM || new Date().toISOString(),

    // --- Armazenamento Local ---
    // Diretório para salvar os arquivos JSON de controle
    DATA_DIR: path.resolve(process.cwd(), 'data')
};