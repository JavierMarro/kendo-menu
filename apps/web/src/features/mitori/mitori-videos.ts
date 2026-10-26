export interface MitoriVideo {
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly playlistId?: string;
}

// Owner-selected additions checked against YouTube oEmbed on 2026-10-26.
export const MITORI_VIDEOS: Readonly<
  Record<
    | 'techniques'
    | 'documentaries'
    | 'kata'
    | 'competition-2026'
    | 'ajkc-finals'
    | 'ajkc-finals-womens',
    readonly MitoriVideo[]
  >
> = {
  techniques: [
    {
      id: 'sAYGaJb2aRg',
      title: 'Naoki Eiga Sensei’s Training at Home',
      author: 'KendoStar – The Kendo Show',
    },
    {
      id: 'M-45zhTViQ4',
      title: 'Ladder Training — Nara University High School',
      author: 'Kendo Jidai International',
    },
    {
      id: 'LcWr7yzeefQ',
      title: 'Footwork — Nara University High School',
      author: 'BUSHIZO TV',
    },
    {
      id: 'L3VNp4oe8kw',
      title: 'DO KENDO — ArigaToKendo video series',
      author: 'Taro Ariga',
      playlistId: 'PLo-0mQzBLAedFJd50atliNPH3F7pZyLIx',
    },
    {
      id: 'aulhj0doWUc',
      title: 'Kote-waza fundamentals — Upper-body movement',
      author: 'Kendo Nippon',
    },
    {
      id: 'ZyJiUitoZZE',
      title: 'Oikomi — Osaka Police Department Kendo Training, Vol. 1',
      author: 'Kendo Jidai International',
    },
    {
      id: 'aO9Pb5la63w',
      title: 'Training at Hiroshima Prefectural Police',
      author: 'Kendo Nippon',
    },
    {
      id: 'YboQmxKTci4',
      title: 'Kendo Training Boot Camp — by Hidehisa Nishimura',
      author: 'TOZANDO INTL.',
    },
    {
      id: 'DLj6-Atr3PA',
      title: 'Kendo Training Boot Camp Part 2 — by Hidehisa Nishimura',
      author: 'TOZANDO INTL.',
    },
    {
      id: '1DwN4zsUPcQ',
      title: 'An introduction to jodan',
      author: 'Kendo Nippon',
    },
    {
      id: 'HKR_dZoMtEA',
      title: 'How to fight in jodan — by Masashi Chiba',
      author: 'Kendo Jidai International',
    },
    {
      id: '69zEIYbaVfo',
      title: 'Countering jodan — Part 1',
      author: 'KENDOｰDOG☆剣道犬',
    },
    {
      id: 'Zv0NJOC_bjo',
      title: 'Jodan no kamae techniques — by Shohei Takenouchi',
      author: 'KAMINARIKAN',
    },
  ],
  'competition-2026': [
    {
      id: 'shOjcAsUZ5M',
      title: '74th All Japan University Kendo Championship — Final: Hosei vs Tsukuba',
      author: '不動心',
    },
    {
      id: '0Sw2s26T4Ds',
      title: '90th Waseda–Keio Kendo Match',
      author: 'K-Project',
    },
    {
      id: 'Y3VhVkkmeQw',
      title: '43rd Waseda–Keio Women’s Kendo Match',
      author: 'K-Project',
    },
    {
      id: '9YoeahvBu2k',
      title: '65th Tokyo Kendo Championship — Imperial Guard Police vs Tokyo Metropolitan Police',
      author: 'LET’S KENDO',
    },
    {
      id: 'PLTj3ptu6HjME',
      title: '68th All Japan Corporate Kendo Championship',
      author: 'LET’S KENDO',
      playlistId: 'PLTj3ptu6HjME',
    },
    {
      id: 'PLBp5E2w5l6hg',
      title: 'National Police Kendo Championship',
      author: 'LET’S KENDO',
      playlistId: 'PLBp5E2w5l6hg',
    },
  ],
  'ajkc-finals': [
    {
      id: 'qYfR983_KwU',
      title: '73rd All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: '8fypjtoXL40',
      title: '72nd All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'wdSilmaKFL4',
      title: '71st All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'dqWiTsmqO2U',
      title: '70th All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'PdJPF0y2IgU',
      title: '69th All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'qFmb-FL_3JQ',
      title: '68th All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'RWImBV6NYt8',
      title: '67th All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: '2afmt07rLCs',
      title: '66th All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'OFpbKy7CcO4',
      title: '65th All Japan Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
  ],
  'ajkc-finals-womens': [
    {
      id: 'xWwnza7khAE',
      title: '64th All Japan Women’s Kendo Championship',
      author: 'KendoWorld',
    },
    {
      id: 'clrg4D_nvVw',
      title: '63rd All Japan Women’s Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'mzVC1kzKqb8',
      title: '62nd All Japan Women’s Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'lyKe5TfP5Bs',
      title: '61st All Japan Women’s Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'pNI9umleZTg',
      title: '60th All Japan Women’s Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: '146bKuuuKP4',
      title: '59th All Japan Women’s Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'ucbRnUqhrvQ',
      title: '58th All Japan Women’s Kendo Championship',
      author: 'All Japan Kendo Federation',
    },
  ],
  documentaries: [
    {
      id: 'ir2B5SApI3k',
      title: 'Naoki Eiga — A Single Blow',
    },
    {
      id: '9393wN3DfLI',
      title: 'Nishimura — The Spirit of Kendo: Path of No Regret',
    },
    { id: 'tw6KvrZDHbk', title: 'Evolution of Kendo' },
    {
      id: '0HPDAFqN74A',
      title: 'Kendo’s Gruelling Challenge (original English narration)',
    },
    {
      id: 'cxH3rEW-V8c',
      title: 'Kendo — The Perfect Ippon',
    },
    {
      id: 'wg3RjKEj9DQ',
      title: 'Tachikiri — Shigeru Ogata',
    },
  ],
  kata: [
    {
      id: 'QIpPUdTCv-Y',
      title: 'Nippon Kendo Kata (English version)',
      author: 'All Japan Kendo Federation',
    },
    {
      id: 'WeS8rmOTBIM',
      title: 'Bokuto ni yoru kendo kihon-waza keiko-ho (Japanese version)',
      author: 'All Japan Kendo Federation',
    },
  ],
};
