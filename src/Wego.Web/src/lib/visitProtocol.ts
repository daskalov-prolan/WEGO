/**
 * The protocol of a visit made on the tablet: the check list, the calculation by trade, drawings and photos, and
 * the confirmation the customer signs on the display. What is asked lives here, in one place, to be changed easily
 * (as the paper forms "Check-Liste Besichtigung (Badumbau)" and "Kalkulation Umbauarbeiten").
 */

/** One question of the check list. A choice is tapped; text and numbers are typed. */
export interface Question {
  id: string
  label: string
  kind: 'choice' | 'text' | 'number' | 'note'
  options?: string[]
  unit?: string
  /** A reminder shown with it, e.g. the new planking of RiGips walls. */
  hint?: string
  /** Asked only when another answer is this one (e.g. how many core drillings, after "ja"). */
  when?: { id: string; is: string | string[] }
  bold?: boolean
}

export interface Section {
  title: string
  hint?: string
  questions: Question[]
}

const JA_NEIN = ['ja', 'nein']

export const CHECKLIST: Section[] = [
  {
    title: 'Objekt',
    questions: [
      { id: 'art', label: 'Art', kind: 'choice', options: ['Einfamilienhaus', 'MFH / Eigentumswohnung', 'Mietwohnung'] },
      { id: 'etage', label: 'Etage', kind: 'text' },
      { id: 'aufzug', label: 'Aufzug vorhanden?', kind: 'choice', options: JA_NEIN },
      { id: 'bauart', label: 'Umbau oder Neubau', kind: 'choice', options: ['Umbau', 'Neubau'] },
      { id: 'schubkarre', label: 'Schubkarre beim Abriss erforderlich?', kind: 'choice', options: JA_NEIN },
      { id: 'container', label: 'Entfernung Aufstellort Bauschuttcontainer zum Haus', kind: 'number', unit: 'm' },
      {
        id: 'aufmerksam', label: 'Wie ist der Kunde auf uns aufmerksam geworden?', kind: 'choice', bold: true,
        options: [
          'Empfehlung (Familie, Freunde, Nachbarn)', 'Google / Internetsuche', 'Unsere Website', 'Social Media',
          'Badcenter / Ausstellung', 'Fahrzeug', 'Stammkunde', 'Sonstiges',
        ],
      },
      { id: 'aufmerksamWie', label: 'Wie genau?', kind: 'text', when: { id: 'aufmerksam', is: 'Sonstiges' } },
    ],
  },
  {
    title: 'Raum',
    questions: [
      { id: 'raumhoehe', label: 'Raumhöhe', kind: 'number', unit: 'm' },
      { id: 'unterkellert', label: 'Bad unterkellert', kind: 'choice', options: JA_NEIN },
      { id: 'eigenerKeller', label: 'bei MFH – eigener Keller?', kind: 'choice', options: JA_NEIN, when: { id: 'art', is: 'MFH / Eigentumswohnung' } },
      { id: 'kellerZugang', label: 'Zugang zum Keller', kind: 'text', when: { id: 'eigenerKeller', is: 'ja' } },
      { id: 'kernbohrung', label: 'Kernbohrung notwendig?', kind: 'choice', options: JA_NEIN },
      { id: 'kernbohrungAnzahl', label: 'Anzahl Kernbohrungen', kind: 'number', when: { id: 'kernbohrung', is: 'ja' } },
      { id: 'entsorgen', label: 'Vorhandene Objekte entsorgen', kind: 'choice', options: ['ja', 'nein', 'teilweise'] },
      { id: 'entsorgenWas', label: 'Welche Objekte?', kind: 'text', when: { id: 'entsorgen', is: 'teilweise' } },
      { id: 'badewanne', label: 'Vorhandene Badewanne', kind: 'choice', options: ['auf Füßen', 'einbetoniert'] },
      { id: 'dusche', label: 'Einbau bodengleicher Dusche möglich', kind: 'choice', options: JA_NEIN },
      { id: 'duscheHoehe', label: 'Voraussichtliche Höhe der Dusche (Einstieg)', kind: 'number', unit: 'cm', when: { id: 'dusche', is: 'nein' } },
      { id: 'jalousie', label: 'Jalousiekasten vorhanden?', kind: 'choice', options: JA_NEIN },
      { id: 'lueftung', label: 'Lüftung vorhanden?', kind: 'choice', options: JA_NEIN },
      { id: 'lueftungGewuenscht', label: 'Lüftung gewünscht?', kind: 'choice', options: JA_NEIN, when: { id: 'lueftung', is: 'nein' } },
      { id: 'lueftungArt', label: 'Art der Lüftung', kind: 'choice', options: ['manuell', 'elektrisch'], when: { id: 'lueftungGewuenscht', is: 'ja' } },
    ],
  },
  {
    title: 'Wände',
    questions: [
      {
        id: 'waende', label: 'Beschaffenheit der Wände (Trockenbau, Mauerwerk etc.)', kind: 'text',
        hint: 'Bei RiGips-Wänden: Hinweis auf erforderliche neue Beplankung!',
      },
      { id: 'waendeUeber', label: 'Wände über Fliesenbelag', kind: 'choice', options: ['Tapete', 'gespachtelt'] },
    ],
  },
  {
    title: 'Decke',
    questions: [
      { id: 'decke', label: 'Vorhandene Decke', kind: 'choice', options: ['Beton', 'RiGips', 'Holzpaneele'] },
      { id: 'deckeOberflaeche', label: 'Oberfläche', kind: 'choice', options: ['gemalert', 'Tapete'] },
      { id: 'tapeteAb', label: 'Tapete abmachen?', kind: 'choice', options: JA_NEIN, when: { id: 'deckeOberflaeche', is: 'Tapete' } },
      { id: 'deckeAbhaengen', label: 'Decke mit RiGips abhängen', kind: 'choice', options: JA_NEIN },
      { id: 'maler', label: 'Malerarbeiten gewünscht?', kind: 'choice', options: JA_NEIN },
    ],
  },
  {
    title: 'Tür',
    hint: 'Bei Öffnung nach innen bitte die Kunden auf eine evtl. erforderliche Kürzung hinweisen.',
    questions: [
      { id: 'tuer', label: 'Neue Tür/Zarge einbauen', kind: 'choice', options: JA_NEIN },
      { id: 'anschlag', label: 'Anschlag ändern', kind: 'choice', options: JA_NEIN },
    ],
  },
  {
    title: 'Fliesen',
    questions: [
      { id: 'fliesenhoeheIst', label: 'Fliesenhöhe momentan', kind: 'number', unit: 'm' },
      { id: 'fliesenhoeheSoll', label: 'Gewünschte Fliesenhöhe', kind: 'number', unit: 'm' },
      { id: 'fliesAufFliese', label: 'Fliese auf Fliese möglich?', kind: 'choice', options: ['ja', 'nein', 'teilweise'] },
    ],
  },
  {
    title: 'Sanitär',
    questions: [
      { id: 'wc', label: 'Vorhandenes WC', kind: 'choice', options: ['wandhängend', 'stehend'] },
      { id: 'bidet', label: 'Bidet', kind: 'choice', options: ['wandhängend', 'stehend', 'keins'] },
      { id: 'urinal', label: 'Urinal', kind: 'choice', options: JA_NEIN },
    ],
  },
  {
    title: 'Heizung',
    questions: [
      { id: 'absperrung', label: 'Separate Absperrung möglich?', kind: 'choice', options: JA_NEIN },
      { id: 'absperrungWo', label: 'Absperrung wo?', kind: 'text', when: { id: 'absperrung', is: 'nein' } },
      { id: 'absperrungZugang', label: 'Zugang?', kind: 'text', when: { id: 'absperrung', is: 'nein' } },
      { id: 'heizkoerper', label: 'Vorhandener Heizkörper', kind: 'text' },
      { id: 'handtuch', label: 'Handtuchtrockner / Badheizkörper gewünscht?', kind: 'choice', options: JA_NEIN },
      { id: 'fbhWasser', label: 'Fußbodenheizung wasserführend gewünscht?', kind: 'choice', options: JA_NEIN },
    ],
  },
  {
    title: 'Elektroinstallation',
    questions: [
      { id: 'fussbodenTemp', label: 'el. Fußbodentemperierung gewünscht?', kind: 'choice', options: JA_NEIN },
      { id: 'kleinarbeiten', label: 'Kleinarbeiten nach Aufwand', kind: 'choice', options: JA_NEIN },
      { id: 'elektriker', label: 'Besichtigung durch Elektrofirma gewünscht?', kind: 'choice', options: JA_NEIN },
    ],
  },
  {
    title: 'Sonstiges',
    hint: 'Genaue Zeichnung und Bilder nicht vergessen!!',
    questions: [
      { id: 'angrenzend', label: 'Umbauarbeiten in angrenzenden Räumen?', kind: 'text' },
      { id: 'kalk', label: 'Kalkhaltiges Wasser / Wasserenthärtungsanlage', kind: 'text' },
      { id: 'notizen', label: 'Weitere Notizen', kind: 'note' },
    ],
  },
]

/** One line of the calculation: hours, material, square metres or a choice, as on the paper form. */
export interface CalcItem {
  id: string
  label: string
  hours?: boolean
  material?: boolean
  qm?: boolean
  options?: string[]
}

export interface CalcGroup {
  title: string
  items: CalcItem[]
}

export const CALCULATION: CalcGroup[] = [
  {
    title: 'Demontage',
    items: [
      { id: 'demSanitaer', label: 'Demontage alte Sanitärobjekte', hours: true },
      { id: 'demWandfliesen', label: 'Wandfliesen abschlagen', hours: true },
      { id: 'demBodenfliesen', label: 'Bodenfliesen abschlagen', hours: true },
      { id: 'demTrockenbau', label: 'Abriss Trockenbau', hours: true },
      { id: 'demDecke', label: 'Abriss Decke', hours: true },
      { id: 'demEstrich', label: 'Estrich ausstemmen', hours: true },
    ],
  },
  {
    title: 'Maurer / Putz + Trockenbau',
    items: [
      { id: 'waendeAusgleichen', label: 'Wände ausgleichen', options: ['spachteln', 'mit Rigips verkl. oder putzen'], qm: true },
      { id: 'bodenAusgleichen', label: 'Boden ausgleichen', options: JA_NEIN },
      { id: 'mauern', label: 'Wände / Duschsitz mauern', hours: true, material: true },
      { id: 'trockenbau', label: 'Trockenbauarbeiten', hours: true, material: true },
      { id: 'deckeRigips', label: 'Decke mit RiGips abhängen', options: JA_NEIN },
      { id: 'estrich', label: 'Estricharbeiten', options: JA_NEIN },
      { id: 'malerarbeiten', label: 'Malerarbeiten', hours: true, material: true },
    ],
  },
  {
    title: 'Sanitärinstallation',
    items: [
      { id: 'frischwasser', label: 'Frischwasser-Verteilung', hours: true, material: true },
      { id: 'abfluss', label: 'Abflussleitungen im Bad', hours: true, material: true },
      { id: 'duschwanne', label: 'Montage + Anschluss Duschwanne', hours: true },
      { id: 'wanne', label: 'Montage + Anschluss Wanne', hours: true },
      { id: 'spuelkasten', label: 'Montage + Anschluss UP WC-Spülkasten', hours: true },
    ],
  },
  {
    title: 'Heizung',
    items: [
      { id: 'heizVersorgung', label: 'Versorgungsleitung', hours: true, material: true },
      { id: 'heizMontage', label: 'Montage', hours: true, material: true },
      { id: 'heizFbh', label: 'Fußbodenheizung – Wasser', hours: true, material: true },
    ],
  },
  {
    title: 'Lüftung',
    items: [{ id: 'lueftung', label: 'Lüftung', hours: true, material: true }],
  },
  {
    title: 'Endmontage',
    items: [
      { id: 'endWaschbecken', label: 'Montage/Anschluss Waschbecken + Armatur', hours: true },
      { id: 'endMoebel', label: 'Montage/Anschluss der Badmöbel', hours: true },
      { id: 'endWc', label: 'Montage/Anschluss WC + WC-Sitz', hours: true },
      { id: 'endWannenarmatur', label: 'Montage/Anschluss Wannenarmatur', hours: true },
      { id: 'endDuscharmatur', label: 'Montage/Anschluss Duscharmatur', hours: true },
      { id: 'endHandtuch', label: 'Montage/Anschluss der Handtuchheizkörper', hours: true },
    ],
  },
]

/** What the customer confirms with his signature (also the separate PDF for the invoice). */
export const CONFIRMATION = {
  title: 'Bestätigung Besichtigung',
  text:
    'Durchführung einer Besichtigung – Inaugenscheinnahme der Sanitäranlagen und technischen Gegebenheiten, ' +
    'Erstellung eines Aufmaßes mit Ist- und Soll-Situation, Kundenberatung und Aufwandschätzung',
  price: '89,00 EUR',
  confirm: 'Hiermit bestätige ich, dass die Besichtigung durchgeführt wurde und ich die Kosten dafür übernehme.',
  credit: 'Der Preis für die Besichtigung in Höhe von 89,00 EUR brutto wird nach Auftragserteilung wieder gutgeschrieben.',
}

/** A drawing (its ink, on squared paper) or a photo. */
export interface Sheet {
  id: string
  name: string
  kind: 'drawing' | 'photo'
  /** PNG of the ink of a drawing (transparent), or the photo as JPEG. */
  image: string | null
}

export interface CalcValue {
  hours?: string
  material?: string
  qm?: string
  choice?: string
}

/** A visit protocol, kept on the tablet until it is done and sent. */
export interface Protocol {
  /** "siteId|date": one protocol per visit. */
  key: string
  siteId: number
  siteName: string
  client: string
  address: string
  phone: string
  mobile: string
  date: string
  time: string
  visitor: string
  answers: Record<string, string>
  calc: Record<string, CalcValue>
  sheets: Sheet[]
  signature: string | null
  signer: string
  /** ISO time it was finished: then the PDFs went to the outbox. */
  finishedAt: string | null
}

export const protocolKey = (siteId: number, date: string) => `${siteId}|${date}`

/** A question is asked: it has no condition, or the answer it depends on is the one named. */
export function isAsked(question: Question, answers: Record<string, string>): boolean {
  if (!question.when) return true
  const wanted = Array.isArray(question.when.is) ? question.when.is : [question.when.is]
  return wanted.includes(answers[question.when.id] ?? '')
}

/** "2,5" or "2.5" -> 2.5; nothing or text -> 0. */
export const toNumber = (value: string | undefined) => {
  const n = parseFloat(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** The hours of a group of the calculation, and of all of them. */
export function calcHours(calc: Record<string, CalcValue>, group?: CalcGroup): number {
  const groups = group ? [group] : CALCULATION
  return groups.reduce((sum, g) => sum + g.items.reduce((s, item) => s + (item.hours ? toNumber(calc[item.id]?.hours) : 0), 0), 0)
}

/** 2.5 -> "2,5" */
export const formatNumber = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 })

/** A file name from the customer, without what a file name cannot hold. */
export const documentFileName = (kind: string, protocol: Pick<Protocol, 'siteName' | 'date'>) =>
  `${kind} ${protocol.siteName} ${protocol.date}`.replace(/[\\/:*?"<>|]+/g, '-').trim() + '.pdf'
