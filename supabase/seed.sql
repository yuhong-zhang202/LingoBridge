-- -----------------------------------------------------------------------------
-- Seed      : dimensions + observation_points
-- Desc      : 6 个维度 + 43 个观察点初始参考数据
-- Created   : 2026-06-02
-- -----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 维度（6 行）
-- ---------------------------------------------------------------------------
insert into dimensions (id, name, sort_order) values
  ('emotion',      '情绪内核', 1),
  ('relationship', '人际羁绊', 2),
  ('space',        '空间感知', 3),
  ('spirit',       '精神栖所', 4),
  ('growth',       '成长演进', 5),
  ('value',        '价值底色', 6);

-- ---------------------------------------------------------------------------
-- 观察点（43 行）
-- ---------------------------------------------------------------------------
insert into observation_points (code, dimension_id, name, layer, mapped_question_count, rich_threshold, sort_order) values
  -- emotion（13）
  ('EMO_01', 'emotion', '最近一段时间的整体状态',       'state',       0, 1,  1),
  ('EMO_02', 'emotion', '日常的能量节奏',               'state',       4, 2,  2),
  ('EMO_03', 'emotion', '一个人时怎么度过时间',         'rhythm',      2, 2,  3),
  ('EMO_04', 'emotion', '让你感到放松的事',             'rhythm',      1, 2,  4),
  ('EMO_05', 'emotion', '让你感到充电的事',             'rhythm',      0, 2,  5),
  ('EMO_06', 'emotion', '会反复回到的小习惯',           'rhythm',      3, 2,  6),
  ('EMO_07', 'emotion', '应对压力时的惯常反应',         'rhythm',      0, 2,  7),
  ('EMO_08', 'emotion', '你和食物的关系',               'rhythm',      3, 2,  8),
  ('EMO_09', 'emotion', '一次让你压力大的具体经历',     'fluctuation', 3, 2,  9),
  ('EMO_10', 'emotion', '一次明显的情绪波动',           'fluctuation', 1, 1, 10),
  ('EMO_11', 'emotion', '会让你失眠的事',               'fluctuation', 0, 1, 11),
  ('EMO_12', 'emotion', '难以启齿/不会跟人说的事',      'fluctuation', 0, 1, 12),
  ('EMO_13', 'emotion', '你和外表/形象的关系',          'fluctuation', 3, 2, 13),

  -- relationship（11）
  ('REL_01', 'relationship', '和家人的日常相处模式',               'rhythm',      1, 2,  1),
  ('REL_02', 'relationship', '一次和家人之间的具体事件',           'fluctuation', 1, 1,  2),
  ('REL_03', 'relationship', '一个让你舒服的朋友',                 'rhythm',      4, 2,  3),
  ('REL_04', 'relationship', '一次和朋友的具体共度',               'fluctuation', 3, 2,  4),
  ('REL_05', 'relationship', '一段亲密关系里的人或事',             'mixed',       1, 1,  5),
  ('REL_06', 'relationship', '一个让你印象深刻的陌生人',           'fluctuation', 4, 2,  6),
  ('REL_07', 'relationship', '和宠物/动物的日常陪伴',              'rhythm',      1, 2,  7),
  ('REL_08', 'relationship', '一次和宠物/动物的特殊互动',          'fluctuation', 1, 1,  8),
  ('REL_09', 'relationship', '一次你帮助别人的经历',               'fluctuation', 1, 1,  9),
  ('REL_10', 'relationship', '一次被别人帮助的经历',               'fluctuation', 2, 1, 10),
  ('REL_11', 'relationship', '一次关系摩擦或冲突',                 'fluctuation', 3, 2, 11),

  -- space（7）
  ('SPA_01', 'space', '你和居住空间的关系',                 'rhythm',      4, 2, 1),
  ('SPA_02', 'space', '日常移动 / 通勤',                   'rhythm',      2, 2, 2),
  ('SPA_03', 'space', '你和所在城市/街区的关系',           'rhythm',      4, 2, 3),
  ('SPA_04', 'space', '一个让你印象深刻的建筑/公共空间',   'fluctuation', 6, 3, 4),
  ('SPA_05', 'space', '你是什么样的旅行者',                'rhythm',      3, 2, 5),
  ('SPA_06', 'space', '一次具体的远行',                    'fluctuation', 2, 1, 6),
  ('SPA_07', 'space', '自然里让你有感觉的时刻',            'mixed',       5, 3, 7),

  -- spirit（6）
  ('SPI_01', 'spirit', '一个反复回去的作品',                   'rhythm',      5, 3, 1),
  ('SPI_02', 'spirit', '一个在特定时期陪着你的作品',           'fluctuation', 1, 1, 2),
  ('SPI_03', 'spirit', '一个改变了你某种看法的作品',           'fluctuation', 1, 1, 3),
  ('SPI_04', 'spirit', '一首歌 / 一件作品带来的纯粹感受',      'mixed',       4, 2, 4),
  ('SPI_05', 'spirit', '一件对你特别的物品',                   'mixed',       5, 3, 5),
  ('SPI_06', 'spirit', '你在数字世界里的栖居',                 'rhythm',      3, 2, 6),

  -- growth（6）
  ('GRO_01', 'growth', '一项你长期坚持的投入',       'rhythm',      4, 2, 1),
  ('GRO_02', 'growth', '一项你学会或正在练的技能',   'rhythm',      5, 3, 2),
  ('GRO_03', 'growth', '一次靠死磕做成的事',         'fluctuation', 5, 3, 3),
  ('GRO_04', 'growth', '一次失败带来的复盘',         'fluctuation', 2, 1, 4),
  ('GRO_05', 'growth', '一次想法的转变',             'fluctuation', 2, 1, 5),
  ('GRO_06', 'growth', '对自己未来方向的思考',       'non_event',   2, 1, 6);
