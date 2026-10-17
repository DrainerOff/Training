// Filter lists behind the common Safari content blockers: AdGuard for Safari uses the AdGuard
// lists; 1Blocker, Wipr, AdBlock Pro and others build on EasyList / EasyPrivacy. Fetched from
// the maintainers' public GitHub repositories (raw files).

const EASYLIST = 'https://raw.githubusercontent.com/easylist/easylist/master';
const ADGUARD = 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters';

export const LISTS = [
  ['EasyList', `${EASYLIST}/easylist/easylist_general_block.txt`],
  ['EasyList', `${EASYLIST}/easylist/easylist_general_block_dimensions.txt`],
  ['EasyList', `${EASYLIST}/easylist/easylist_specific_block.txt`],
  ['EasyList', `${EASYLIST}/easylist/easylist_general_hide.txt`],
  ['EasyList', `${EASYLIST}/easylist/easylist_allowlist_general_hide.txt`],
  ['EasyPrivacy', `${EASYLIST}/easyprivacy/easyprivacy_general.txt`],
  ['EasyPrivacy', `${EASYLIST}/easyprivacy/easyprivacy_specific.txt`],
  ['EasyPrivacy', `${EASYLIST}/easyprivacy/easyprivacy_allowlist.txt`],
  ["Fanboy's Annoyance", `${EASYLIST}/fanboy-addon/fanboy_annoyance_general_block.txt`],
  ["Fanboy's Annoyance", `${EASYLIST}/fanboy-addon/fanboy_annoyance_general_hide.txt`],
  ["Fanboy's Social", `${EASYLIST}/fanboy-addon/fanboy_social_general_block.txt`],
  ["Fanboy's Social", `${EASYLIST}/fanboy-addon/fanboy_social_general_hide.txt`],
  ['AdGuard Russian', `${ADGUARD}/filter_1_Russian/filter.txt`],
  ['AdGuard Base', `${ADGUARD}/filter_2_Base/filter.txt`],
  ['AdGuard Tracking Protection', `${ADGUARD}/filter_3_Spyware/filter.txt`],
  ['AdGuard Social', `${ADGUARD}/filter_4_Social/filter.txt`],
  ['AdGuard Mobile', `${ADGUARD}/filter_11_Mobile/filter.txt`],
  ['AdGuard Annoyances', `${ADGUARD}/filter_14_Annoyances/filter.txt`],
  ['AdGuard Cookie Notices', `${ADGUARD}/filter_18_Annoyances_Cookies/filter.txt`],
  ['AdGuard Popups', `${ADGUARD}/filter_19_Annoyances_Popups/filter.txt`],
  ['AdGuard Mobile App Banners', `${ADGUARD}/filter_20_Annoyances_MobileApp/filter.txt`],
  ['AdGuard Other Annoyances', `${ADGUARD}/filter_21_Annoyances_Other/filter.txt`],
  ['AdGuard Widgets', `${ADGUARD}/filter_22_Annoyances_Widgets/filter.txt`],
];

// Where the app is published; rules are evaluated for requests to this host.
export const HOST = 'draineroff.github.io';
export const BASE = `https://${HOST}/Training/`;
