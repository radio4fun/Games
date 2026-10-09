"""
Converte as anotações do dataset (Danilov et al., 2021 - Mendeley Data ydrm75xywg)
em quadros-chave para o CONFIG do EscadaVascular.html.

Uso:
    python anotacoes_para_json.py PASTA_DO_PACIENTE  [--prefixo 14_007_3] [--largura 512] [--passo 5]

Lê os arquivos .xml (formato Pascal VOC: <object><bndbox><xmin>...) com nomes do tipo
14_007_3_0030.xml, pega o número do quadro do final do nome e imprime o trecho
videoQuadrosChave / videoJanela / imagemCaixa pronto para colar no CONFIG.
Observação: confira se a numeração dos .bmp começa no quadro 0 ou 1 do vídeo e,
se precisar, use --deslocamento.
"""
import argparse, glob, json, os, re
import xml.etree.ElementTree as ET

ap = argparse.ArgumentParser()
ap.add_argument('pasta'); ap.add_argument('--prefixo', default='14_007_3')
ap.add_argument('--largura', type=int, default=512); ap.add_argument('--altura', type=int, default=512)
ap.add_argument('--passo', type=int, default=5, help='usar 1 quadro a cada N como quadro-chave')
ap.add_argument('--deslocamento', type=int, default=0, help='somar ao número do quadro')
ap.add_argument('--quadro-imagem', type=int, default=30)
a = ap.parse_args()

kfs = []
for f in sorted(glob.glob(os.path.join(a.pasta, a.prefixo + '_*.xml'))):
    m = re.search(r'_(\d+)\.xml$', f)
    if not m: continue
    root = ET.parse(f).getroot()
    W = float(root.findtext('size/width') or a.largura); H = float(root.findtext('size/height') or a.altura)
    for obj in root.iter('object'):
        bb = obj.find('bndbox')
        x0, y0, x1, y1 = (float(bb.findtext(k)) for k in ('xmin', 'ymin', 'xmax', 'ymax'))
        kfs.append({'f': int(m.group(1)) + a.deslocamento, 'x': round(x0 / W, 3), 'y': round(y0 / H, 3),
                    'w': round((x1 - x0) / W, 3), 'h': round((y1 - y0) / H, 3)})
        break  # uma lesão por quadro

if not kfs:
    raise SystemExit('Nenhum .xml encontrado com o prefixo ' + a.prefixo)
kfs.sort(key=lambda k: k['f'])
img = min(kfs, key=lambda k: abs(k['f'] - a.quadro_imagem))
sel = kfs[::a.passo] + ([kfs[-1]] if kfs[-1] not in kfs[::a.passo] else [])
print(json.dumps({'referenciaConfirmada': True,
                  'imagemCaixa': {k: img[k] for k in 'xywh'},
                  'videoQuadrosChave': sel,
                  'videoJanela': [kfs[0]['f'], kfs[-1]['f']]}, indent=2))
