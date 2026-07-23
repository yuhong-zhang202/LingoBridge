# Anki 卡背 · 分点式例句探针（go/no-go 判分用）

- 模型 `qwen-plus` · temperature 0.7 · 每题 N=2 · 不分档（v0.3）
- part1/2 审【忠料事实层/强度层 · 对点 · 口语 · 中式】；part3 审【论据贴合 · 常识不离谱 · 对点 · 口语 · 中式】（part3 无语料、不审忠料）
- 机器列：H1纯英文 H2无md H3无破折号 H4无泄漏 H5单句 H6长度≤上限 H7非空（H6 不一票否决）
- ⚠️ 重点看 **B2thin（薄素材）**：语料只有「公园+放松」，看 3 个点会不会为填格子编造做法/频率/氛围。

> 人工判分：逐条盲判每句例句是否 ① 忠料事实层(part1/2) ② 对准它那个点 ③ 口语可念 ④ 非中式；part3 换 ① 论据贴合 ② 常识不离谱。

- 例句总数 38　机器硬规则通过 26/38　生成失败 0　解析失败 0
- token：prompt 9376 + completion 963 = 10339

---
## Part 1 / Part 2（有语料，审忠料）

### 输入 A1（Part 1·作息）
**题面**：Do you usually go to bed early or late?

**中文语料**：我是典型的夜猫子，一般都过了十二点才睡，晚上十点以后脑子反而最清醒，重要的事我都留到深夜做。早上基本起不来，闹钟得响好几个才爬得起来，上午整个人是懵的。

**run1**：
  - **[0] 怎么起手**（14词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I'm a real night owl—I usually don't go to bed until after midnight.
  - **[1] 收在哪**（17词｜H1✓ H2✓ H3✓ H4✓ H5✗ H6✓ H7✓）
    > My brain actually wakes up after 10 p.m., so I do important stuff late at night.

**run2**：
  - **[0] 怎么起手**（14词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I'm a real night owl—I usually don't go to bed until after midnight.
  - **[1] 收在哪**（17词｜H1✓ H2✓ H3✓ H4✓ H5✗ H6✓ H7✓）
    > My brain actually wakes up after 10 p.m., so I save important tasks for late night.


**A1 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐

---

### 输入 A2（Part 1·室内vs户外）
**题面**：Do you prefer spending your free time indoors or outdoors?

**中文语料**：我其实更喜欢待在家里。一到周末我就想窝在家，泡杯茶，打开一局策略游戏能玩一下午，中间连水都忘了喝。那种不用理任何人、完全按自己节奏来的感觉特别舒服，出门反而觉得累。

**run1**：
  - **[0] 怎么起手**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I definitely prefer spending my free time indoors.
  - **[1] 收在哪**（16词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Like on weekends, I just chill at home playing strategy games and forget to drink water.

**run2**：
  - **[0] 怎么起手**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I definitely prefer spending my free time indoors.
  - **[1] 收在哪**（16词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Like on weekends, I just chill at home playing strategy games and forget to drink water.


**A2 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐

---

### 输入 B1（Part 2·道歉经历）
**题面**：Describe a time when you apologized to someone. You should say: who, what the situation was, why, and how you felt afterwards.

**中文语料**：我要说的是跟我室友道歉那次。我俩之前一直因为宿舍卫生的分工闹得不太愉快，我总觉得我干得多。有次我没忍住，当着别人的面说她从来不收拾，话说得挺重的。她当时没吭声，但我看得出来她很受伤，那天晚上气氛特别僵。后来我冷静下来想，其实她那段时间在准备考试特别忙，是我太计较了。第二天我主动跟她说了对不起，还说以后分工的事我们好好商量。她一下子就放松了，说其实她也有做得不好的地方。那次之后我俩反而比以前更聊得开了，我也学会了有情绪先别急着开口。

**run1**：
  - **[0] 交代背景**（12词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It was an apology to my roommate about our dorm cleaning duties.
  - **[1] 讲清重点**（19词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I snapped at her in front of others, saying she never cleaned up — and it really hurt her feelings.
  - **[2] 补得更完整**（15词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > After we talked it out, we got along even better and started communicating more openly.

**run2**：
  - **[0] 交代背景**（12词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It was my roommate, and it was about our dorm cleaning duties.
  - **[1] 讲清重点**（18词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I snapped at her in front of others, saying she never cleaned up — it was harsh and unfair.
  - **[2] 补得更完整**（15词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > After apologizing, we talked things through and ended up getting along even better than before.


**B1 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐

---

### 输入 B2（Part 2·放松的地方）
**题面**：Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.

**中文语料**：我最喜欢去的地方是家附近一个不大的公园，走路十分钟就到，我基本每天傍晚都会去。我一般什么也不干，就沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗的和跑步的人。那儿有一排很老的柳树，风一吹特别安静。忙了一天之后去那儿走走，脑子里乱七八糟的事好像慢慢就理顺了，整个人会松下来。比起在家躺着刷手机，我觉得那种放空反而更解乏。

**run1**：
  - **[0] 交代背景**（12词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home—I walk there every evening.
  - **[1] 讲清重点**（24词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I just stroll around the lake with music on, watching people walk dogs or run, and the old willow trees make it super quiet.
  - **[2] 补得更完整**（20词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > My mind clears and I truly unwind, which feels way more refreshing than lying at home scrolling on my phone.

**run2**：
  - **[0] 交代背景**（12词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home—I walk there every evening.
  - **[1] 讲清重点**（21词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I just stroll around the lake with music on, watching people and feeling the quiet breeze through the old willow trees.
  - **[2] 补得更完整**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Unlike scrolling on my phone at home, this empty-headed walk actually refreshes me.


**B2 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐

---

### 输入 B2thin（Part 2·放松的地方(薄素材)）
**题面**：Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.

**中文语料**：我喜欢去我家附近的一个公园放松，感觉挺好的。

**run1**：
  - **[0] 交代背景**（15词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a park near my home, and I go there whenever I need a break.
  - **[1] 讲清重点**（19词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I just sit on a bench, watch people walk by, and listen to birds—it’s quiet and calm.
  - **[2] 补得更完整**（12词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Unlike busy streets or noisy cafes, it feels peaceful and totally mine.

**run2**：
  - **[0] 交代背景**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a park near my home, and I go there almost every weekend.
  - **[1] 讲清重点**（19词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I just sit on a bench, watch people walk by, and listen to birds—it’s quiet and slow-paced.
  - **[2] 补得更完整**（16词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Unlike busy streets or crowded malls, it feels calm and private, like my own little break.


**B2thin 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐

---

## Part 3（无语料，审论据贴合+常识）

### 输入 C1（Part 3·讨论题）
**题面**：Do you think people apologize enough these days?

**run1**：
  - **[0] 表明立场**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I think people actually apologize less than before.
  - **[1] 讲清理由**（15词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Many just say 'sorry' quickly to end the conversation, not because they truly mean it.
  - **[2] 延伸对比**（19词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > Back in the past, saying sorry often meant taking real action—like fixing what went wrong or making amends.

**run2**：
  - **[0] 表明立场**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I think people actually apologize less than before.
  - **[1] 讲清理由**（11词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > So many just say 'sorry' quickly without meaning it, especially online.
  - **[2] 延伸对比**（14词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Back then, an apology often meant face-to-face talk and real effort to fix things.


**C1 判分**（人填）：论据贴合 ☐　常识不离谱 ☐　对点 ☐　口语 ☐　中式 ☐

---

### 输入 C2（Part 3·讨论题）
**题面**：Is it important for a city to protect its old buildings?

**run1**：
  - **[0] 表明立场**（9词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Yes, I strongly believe old buildings should be protected.
  - **[1] 讲清理由**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > They carry stories and traditions that help us feel connected to our past.
  - **[2] 延伸对比**（26词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✗ H7✓）
    > Of course, some old buildings aren’t safe or practical anymore, so we might need to adapt them instead of keeping them exactly as they are.

**run2**：
  - **[0] 表明立场**（9词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Yes, I think preserving old buildings is really important.
  - **[1] 讲清理由**（14词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > They carry stories and memories that help people feel connected to their community's past.
  - **[2] 延伸对比**（24词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > Of course, some old buildings aren’t practical for modern life—like lacking elevators or insulation—so we might need to adapt them carefully.


**C2 判分**（人填）：论据贴合 ☐　常识不离谱 ☐　对点 ☐　口语 ☐　中式 ☐

---
