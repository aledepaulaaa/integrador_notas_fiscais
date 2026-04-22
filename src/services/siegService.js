// src/services/siegService.js
const axios = require('axios');
const { SIEG_API_BASE, SIEG_API_KEY, SIEG_PAGE_SIZE, SIEG_CLIENT_ID, SIEG_SECRET_KEY } = require('../config');
const { Buffer } = require('buffer');
const JSZip = require('jszip');

let cachedToken = null;
let tokenExpiry = null;

async function getAuthToken() {
    // Se o token ainda é válido (com margem de segurança de 5 minutos), retorna o cache
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
        return cachedToken;
    }

    log('Gerando novo token JWT na SIEG...');
    
    // Validação de credenciais
    if (!SIEG_CLIENT_ID || !SIEG_SECRET_KEY) {
        const msg = `Credenciais SIEG incompletas: CLIENT_ID=${SIEG_CLIENT_ID ? 'OK' : 'MISSING'}, SECRET_KEY=${SIEG_SECRET_KEY ? 'OK' : 'MISSING'}`;
        log(`ERRO: ${msg}`);
        throw new Error(msg);
    }

    try {
        const response = await axios.post(`${SIEG_API_BASE}/api/v1/create-jwt`, {}, {
            headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': SIEG_CLIENT_ID,
                'X-Secret-Key': SIEG_SECRET_KEY
            }
        });

        if (response.data && typeof response.data === 'string') {
            cachedToken = response.data;
            // Define expiração (padrão 24h, mas vamos usar o que vier ou 24h)
            // A documentação diz que dura 24h.
            tokenExpiry = Date.now() + (24 * 60 * 60 * 1000); 
            log('Token JWT gerado com sucesso.');
            return cachedToken;
        } else {
            throw new Error('Resposta de JWT inválida da SIEG: ' + JSON.stringify(response.data));
        }
    } catch (err) {
        const msg = err.response?.data?.Message || err.response?.data?.message || err.message;
        const status = err.response?.status || 'N/A';
        log(`ERRO ${status} ao gerar JWT: ${msg}`);
        throw err;
    }
}

const client = axios.create({
    baseURL: SIEG_API_BASE,
    timeout: 120000 // 2 minutos
});

// Interceptor para adicionar headers dinâmicos em cada requisição
client.interceptors.request.use(async (config) => {
    const token = await getAuthToken();
    config.headers['Content-Type'] = 'application/json';
    config.headers['X-API-Key'] = SIEG_API_KEY;
    config.headers['Authorization'] = `Bearer ${token}`;
    // NOTA: X-Client-Id e X-Secret-Key são APENAS para gerar JWT, não para requisições normais
    return config;
}, (error) => {
    return Promise.reject(error);
});

function log(msg) { console.log(`[${new Date().toLocaleString('pt-BR')}] ${msg}`); }

async function post(path, payload) {
    log(`SIEG POST ${path}`);
    try {
        const response = await client.post(path, payload);
        return response;
    } catch (err) {
        const status = err.response?.status || 'N/A';
        const errorMsg = err.response?.data?.Message || 
                        err.response?.data?.message || 
                        err.response?.data?.ErrorMessage ||
                        JSON.stringify(err.response?.data) ||
                        err.message;
        log(`ERRO ${status} em ${path}: ${errorMsg}`);
        throw err;
    }
}

async function contarNotas({ cnpj, startISO, endISO }) {
    const payload = {
        DataEmissaoInicio: startISO,
        DataEmissaoFim: endISO,
        DataUploadInicio: startISO,
        DataUploadFim: endISO
    };
    
    // Adicionar CnpjDest apenas se não estiver vazio
    if (cnpj && cnpj.trim() !== '') {
        payload.CnpjDest = cnpj;
    }
    const response = await post('/api/v1/contar-xmls', payload);
    // A resposta pode vir encapsulada em { Data: { NFe, NFCe, ... } }
    const data = (response.data?.Data || response.data) || {};
    const total = (data.NFe || 0) + (data.NFCe || 0) + (data.CTe || 0) + (data.CFe || 0) + (data.NFSe || 0);
    log(`Contagem para ${cnpj}: ${total} notas encontradas no período.`);
    return total;
}

async function baixarNotas({ cnpj, startISO, endISO, total }) {
    if (total === 0) return [];

    const allXmls = [];
    const pages = Math.ceil(total / SIEG_PAGE_SIZE);
    log(`Iniciando download de ${total} notas em ${pages} página(s)...`);

    // Rate limiting: 10 requisições por minuto = 1 requisição a cada 6 segundos
    const RATE_LIMIT_DELAY = 6000; // 6 segundos entre requisições
    let requestCount = 0;
    const startTime = Date.now();

    for (let p = 0; p < pages; p++) {
        const skip = p * SIEG_PAGE_SIZE; // Incrementa de 50 em 50 (SIEG_PAGE_SIZE)
        const take = Math.min(SIEG_PAGE_SIZE, total - skip);

        // Verificação de paginação correta
        log(`Pagina ${p + 1}/${pages}: skip=${skip}, take=${take} (total: ${total})`);

        const payload = {
            TipoXml: 1, // 1 para NFe
            Take: take,
            Skip: skip,
            DataEmissaoInicio: startISO,
            DataEmissaoFim: endISO,
            DataUploadInicio: startISO, // Adicionado para igualar filtros do contar
            DataUploadFim: endISO,     // Adicionado para igualar filtros do contar
            BaixarEventos: false
        };
        
        // Adicionar CnpjDest apenas se não estiver vazio
        if (cnpj && cnpj.trim() !== '') {
            payload.CnpjDest = cnpj;
        }

        try {
            // Rate limiting: aguardar se necessário
            requestCount++;
            if (requestCount > 1) {
                const elapsed = Date.now() - startTime;
                const expectedTime = (requestCount - 1) * RATE_LIMIT_DELAY;
                if (elapsed < expectedTime) {
                    const waitTime = expectedTime - elapsed;
                    log(`Rate limit: aguardando ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }

            log(`Buscando página ${p + 1}/${pages} (take=${take}, skip=${skip})...`);
            
            // Fazer requisição com responseType: 'arraybuffer' para receber ZIP
            const response = await axios.post(`${SIEG_API_BASE}/api/v1/baixar-xmls`, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': SIEG_API_KEY,
                    'Authorization': `Bearer ${await getAuthToken()}`
                },
                responseType: 'arraybuffer'
            });

            // Processar resposta ZIP
            if (response.data && response.data.length > 0) {
                try {
                    const zip = new JSZip();
                    const content = await zip.loadAsync(response.data);
                    const files = Object.keys(content.files);
                    
                    log(`ZIP recebido com ${files.length} arquivo(s)`);
                    
                    for (const filename of files) {
                        const file = content.files[filename];
                        if (!file.dir && filename.endsWith('.xml')) {
                            const xmlContent = await file.async('string');
                            
                            // Extrair chave de 44 dígitos
                            const match = xmlContent.match(/<chNFe>(\d{44})<\/chNFe>|<infNFe\s+Id="NFe(\d{44})"/);
                            const chave = match ? (match[1] || match[2]) : null;
                            
                            allXmls.push({ chave: chave, xml: xmlContent });
                            log(`Nota extraída: ${filename} - ${chave}`);
                        }
                    }
                    
                    log(`Pagina ${p + 1} processada: ${allXmls.length} XML(s) totais`);
                    
                } catch (zipError) {
                    log(`ERRO ao processar ZIP: ${zipError.message}`);
                }
            } else {
                log(`AVISO Página ${p + 1}: Sem dados recebidos`);
            }
        } catch (err) {
            const errorMessage = err.response?.data?.[0] || err.response?.data?.Message || err.message;
            log(`Falha ao baixar a página ${p + 1}. Erro: ${errorMessage}`);
        }
    }
    return allXmls;
}

module.exports = { getAuthToken, contarNotas, baixarNotas };