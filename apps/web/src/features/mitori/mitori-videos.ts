export interface MitoriVideo {
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly playlistId?: string;
}

// Owner-selected videos; titles and channels checked against YouTube oEmbed on 2026-10-16.
export const MITORI_VIDEOS: Readonly<
  Record<'techniques' | 'documentaries' | 'kata', readonly MitoriVideo[]>
> = {
  techniques: [
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
      id: 'ZyJiUitoZZE',
      title: 'Oikomi — Osaka Police Department Kendo Training, Vol. 1',
      author: 'Kendo Jidai International',
    },
    {
      id: 'sAYGaJb2aRg',
      title: 'Naoki Eiga Sensei’s Training at Home',
      author: 'KendoStar – The Kendo Show',
    },
    {
      id: 'aO9Pb5la63w',
      title: 'Training at Hiroshima Prefectural Police',
      author: 'Kendo Nippon',
    },
    {
      id: 'M-45zhTViQ4',
      title: 'Ladder Training — Nara University High School',
      author: 'Kendo Jidai International',
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
      id: '1DwN4zsUPcQ',
      title: 'An introduction to jodan',
      author: 'Kendo Nippon',
    },
    {
      id: 'Zv0NJOC_bjo',
      title: 'Jodan no kamae techniques — by Shohei Takenouchi',
      author: 'KAMINARIKAN',
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
