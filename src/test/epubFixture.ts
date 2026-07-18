import { strToU8, zipSync } from 'fflate'

type TestEpubOptions = {
  version?: '2.0' | '3.0'
  frontMatter?: boolean
  noReadableChapters?: boolean
}

export function createTestEpub(title = 'Fixture Book', options: TestEpubOptions = {}) {
  const version = options.version ?? '3.0'
  const frontMatterManifest = options.frontMatter
    ? '<item id="front" href="Text/front.xhtml" media-type="application/xhtml+xml"/>'
    : ''
  const frontMatterSpine = options.frontMatter ? '<itemref idref="front"/>' : ''
  const chapterOne = options.noReadableChapters
    ? '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section type="titlepage"><h1>Fixture Book</h1></section></body></html>'
    : '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section><h1>Arrival</h1><p>Mara\u00a0  met\n Mr Gray at the gate .</p><p>The rain followed Mara inside through the silent hall beneath the northern tower.</p><p>Mr Gray kept the northern key.</p></section></body></html>'
  const chapterTwo = options.noReadableChapters
    ? '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section type="copyright-page"><p>Copyright.</p></section></body></html>'
    : '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><section><h1>The Keeper</h1><p>The Keeper waited below.</p><p>Mr Gray said, “I am Elias.”</p><p>Elias called the Keeper his father.</p></section></body></html>'
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language><dc:identifier>fixture-1</dc:identifier></metadata><manifest>${frontMatterManifest}<item id="one" href="Text/chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="two" href="Text/chapter-2.xhtml" media-type="application/xhtml+xml"/></manifest><spine>${frontMatterSpine}<itemref idref="one"/><itemref idref="two"/></spine></package>`),
    'OEBPS/Text/chapter-1.xhtml': strToU8(chapterOne),
    'OEBPS/Text/chapter-2.xhtml': strToU8(chapterTwo),
  }
  if (options.frontMatter) {
    entries['OEBPS/Text/front.xhtml'] = strToU8('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body type="titlepage"><h1>Fixture Book</h1></body></html>')
  }
  return zipSync(entries, { level: 0 })
}
