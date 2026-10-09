/**
 * Escada Vascular — grava as respostas finais numa planilha Google.
 *
 * Como instalar (uma vez, ~5 minutos):
 *  1. Crie uma planilha no Google Drive (ex.: "Escada Vascular - respostas").
 *  2. Menu Extensões > Apps Script. Apague o conteúdo e cole este arquivo inteiro. Salve.
 *  3. Implantar > Nova implantação > tipo "App da Web".
 *       Executar como: Eu   |   Quem pode acessar: Qualquer pessoa
 *  4. Autorize, copie a URL que termina em /exec e cole em envioUrl no CONFIG do EscadaVascular.html.
 *
 * Cada aluno que clicar em "Finalizar" vira uma linha na aba "Respostas".
 * Para baixar: Arquivo > Fazer download > .csv (ou .txt separado por tabulação).
 */
const ABA = 'Respostas';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);                       // evita linhas misturadas se muitos alunos enviarem juntos
  try {
    const dados = JSON.parse(e.postData.contents);
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const aba = planilha.getSheetByName(ABA) || planilha.insertSheet(ABA);
    if (aba.getLastRow() === 0) aba.appendRow(Object.keys(dados));   // cabeçalho na primeira vez
    const cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0];
    aba.appendRow(cabecalho.map(k => (k in dados ? dados[k] : '')));
    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}

// Abra a URL /exec no navegador para testar: deve aparecer "Escada Vascular: pronto".
function doGet() {
  return ContentService.createTextOutput('Escada Vascular: pronto');
}
