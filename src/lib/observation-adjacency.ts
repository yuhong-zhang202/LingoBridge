/**
 * @module   observation-adjacency
 * @desc     观察点邻接表 —— 每个观察点按优先级排列的「语义相邻」观察点。matchByStory 的第三层
 *           邻居兜底用它：当主观察点与故事副观察点都召不到题时，依优先级借相邻观察点的题，避免直接 noMatch。
 *           仅表达「换个角度也能答」的邻近关系，不改变主/副萃取结果。
 * @author   LingoBridge
 * @created  2026-07-13
 */

/** 观察点 code → 邻居 code 列表（按借用优先级降序）。 */
export const OBSERVATION_ADJACENCY: Record<string, string[]> = {
  EMO_01: ['EMO_02', 'EMO_04', 'GRO_06'],
  EMO_02: ['EMO_01', 'EMO_04', 'EMO_11'],
  EMO_03: ['EMO_04', 'EMO_05', 'SPI_06'],
  EMO_04: ['EMO_05', 'EMO_03', 'SPA_07'],
  EMO_05: ['EMO_04', 'EMO_03', 'GRO_01'],
  EMO_06: ['EMO_02', 'EMO_04', 'GRO_01'],
  EMO_07: ['EMO_09', 'EMO_04', 'GRO_04'],
  EMO_08: ['REL_01', 'EMO_04', 'SPA_05'],
  EMO_09: ['EMO_10', 'EMO_07', 'GRO_03'],
  EMO_10: ['EMO_09', 'SPI_04', 'GRO_03'],
  EMO_11: ['EMO_02', 'EMO_09', 'EMO_07'],
  EMO_12: ['EMO_10', 'REL_03', 'EMO_01'],
  EMO_13: ['EMO_06', 'GRO_05', 'EMO_01'],
  REL_01: ['REL_02', 'EMO_08', 'REL_03'],
  REL_02: ['REL_01', 'EMO_10', 'EMO_08'],
  REL_03: ['REL_04', 'REL_01', 'REL_06', 'REL_12'],
  REL_04: ['REL_03', 'EMO_05', 'EMO_08'],
  REL_05: ['REL_03', 'REL_06', 'REL_04'],
  REL_06: ['REL_10', 'REL_03', 'REL_09', 'REL_12'],
  REL_07: ['REL_08', 'EMO_06', 'REL_01'],
  REL_08: ['REL_07', 'EMO_10', 'REL_02'],
  REL_09: ['REL_10', 'REL_03', 'VAL_02'],
  REL_10: ['REL_09', 'REL_06', 'VAL_02'],
  REL_11: ['VAL_01', 'REL_02', 'REL_03'],
  REL_12: ['REL_03', 'REL_06', 'REL_01'],
  SPA_01: ['SPA_03', 'SPA_04', 'EMO_06'],
  SPA_02: ['EMO_04', 'SPA_03', 'EMO_02'],
  SPA_03: ['SPA_01', 'SPA_04', 'SPA_02'],
  SPA_04: ['SPA_03', 'SPA_07', 'SPI_04'],
  SPA_05: ['SPA_06', 'SPA_07', 'EMO_05'],
  SPA_06: ['SPA_05', 'SPA_07', 'EMO_05'],
  SPA_07: ['SPA_06', 'SPA_08', 'EMO_04'],
  SPA_08: ['SPA_07', 'GRO_01', 'EMO_04'],
  SPI_01: ['SPI_02', 'SPI_04', 'EMO_04'],
  SPI_02: ['SPI_01', 'SPI_03', 'SPI_04'],
  SPI_03: ['SPI_01', 'SPI_02', 'GRO_05'],
  SPI_04: ['SPI_01', 'EMO_10', 'SPA_04'],
  SPI_05: ['SPI_01', 'EMO_06', 'SPI_06'],
  SPI_06: ['SPI_01', 'EMO_03', 'SPI_05'],
  GRO_01: ['GRO_02', 'EMO_05', 'EMO_06'],
  GRO_02: ['GRO_01', 'GRO_03', 'EMO_05'],
  GRO_03: ['GRO_02', 'GRO_04', 'EMO_09'],
  GRO_04: ['GRO_05', 'GRO_03', 'EMO_09'],
  GRO_05: ['GRO_04', 'SPI_03', 'GRO_06'],
  GRO_06: ['GRO_07', 'GRO_05', 'EMO_01'],
  GRO_07: ['GRO_06', 'GRO_03', 'VAL_03'],
  VAL_01: ['REL_11', 'VAL_03', 'VAL_02'],
  VAL_02: ['VAL_03', 'VAL_01', 'REL_09'],
  VAL_03: ['VAL_02', 'VAL_01', 'GRO_07'],
}
