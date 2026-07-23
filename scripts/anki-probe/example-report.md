# Anki 卡背 · 分点式例句 + 留空出口探针（go/no-go 判分用）

- 模型 `qwen-plus` · temperature 0.7 · 每题 N=2 · 不分档（v0.3）· SYSTEM 与生产 anki-answer-prompt.ts 同源
- part1/2 审【忠料事实层/强度层 · 对点 · 口语 · 中式 · 留空是否恰当】；part3 审【论据贴合 · 常识不离谱 · 对点 · 口语 · 中式】
- 机器列：H1纯英文 H2无md H3无破折号 H4无泄漏 H5单句 H6长度≤22 H7非空（H6 不一票否决）；留空点不过机器
- ⚠️ 留空验证两问：① 会编的薄素材点（B2thin/B2-40/B2-60 的做法/氛围/对比）现在【正确留空】还是【仍编】？
  ② 完整语料点（A1/A2/B1/B2）有没有被【误留空】？

> 人工判分：逐条盲判每句例句 ① 忠料事实层(part1/2) ② 对准它那个点 ③ 口语可念 ④ 非中式；留空点判「留得对不对」；part3 换 ① 论据贴合 ② 常识不离谱。

- 例句总数（非留空）42　机器硬规则通过 27/42　生成失败 0　解析失败 0
- 留空统计：完整组 2/20 留空（应≈0，>0 即可能误留空）　薄素材组 6/18 留空（薄素材点应偏高）
- token：prompt 16958 + completion 2089 = 19047

---
## Part 1 / Part 2（有语料，审忠料 + 留空）

### 输入 A1（Part 1·作息·full）
**题面**：Do you usually go to bed early or late?

**中文语料**：我是典型的夜猫子，一般都过了十二点才睡，晚上十点以后脑子反而最清醒，重要的事我都留到深夜做。早上基本起不来，闹钟得响好几个才爬得起来，上午整个人是懵的。

**run1**：
  - **[0] 怎么起手**（12词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I'm a real night owl—I usually go to bed after midnight.
  - **[1] 收在哪**（18词｜H1✓ H2✓ H3✓ H4✓ H5✗ H6✓ H7✓）
    > My brain actually feels most alert after 10 p.m., so I save important tasks for late night.

**run2**：
  - **[0] 怎么起手**（12词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I'm a real night owl—I usually go to bed after midnight.
  - **[1] 收在哪**（18词｜H1✓ H2✓ H3✓ H4✓ H5✗ H6✓ H7✓）
    > My brain actually feels most alert after 10 p.m., so I save important tasks for late night.


**A1 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

### 输入 A2（Part 1·室内vs户外·full）
**题面**：Do you prefer spending your free time indoors or outdoors?

**中文语料**：我其实更喜欢待在家里。一到周末我就想窝在家，泡杯茶，打开一局策略游戏能玩一下午，中间连水都忘了喝。那种不用理任何人、完全按自己节奏来的感觉特别舒服，出门反而觉得累。

**run1**：
  - **[0] 怎么起手**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I actually prefer spending my free time indoors.
  - **[1] 收在哪**（21词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Like on weekends, I just want to stay home, brew a cup of tea, and play a strategy game all afternoon.

**run2**：
  - **[0] 怎么起手**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I actually prefer spending my free time indoors.
  - **[1] 收在哪**（17词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > Like last weekend — I just stayed home, brewed some tea, and played a strategy game for hours.


**A2 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

### 输入 B1（Part 2·道歉经历·full）
**题面**：Describe a time when you apologized to someone. You should say: who, what the situation was, why, and how you felt afterwards.

**中文语料**：我要说的是跟我室友道歉那次。我俩之前一直因为宿舍卫生的分工闹得不太愉快，我总觉得我干得多。有次我没忍住，当着别人的面说她从来不收拾，话说得挺重的。她当时没吭声，但我看得出来她很受伤，那天晚上气氛特别僵。后来我冷静下来想，其实她那段时间在准备考试特别忙，是我太计较了。第二天我主动跟她说了对不起，还说以后分工的事我们好好商量。她一下子就放松了，说其实她也有做得不好的地方。那次之后我俩反而比以前更聊得开了，我也学会了有情绪先别急着开口。

**run1**：
  - **[0] 交代背景**（16词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I apologized to my roommate because I'd criticized her about cleaning duties in front of others.
  - **[1] 讲清重点**（17词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I snapped at her publicly, saying she never cleaned up — and that made her look really hurt.
  - **[2] 补得更完整**（12词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Afterwards, we actually got closer and started talking more openly than before.

**run2**：
  - **[0] 交代背景**（17词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It was with my roommate, after I criticized her harshly about cleaning duties in front of others.
  - **[1] 讲清重点**（19词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I snapped because I felt I was doing way more chores, and I said something really hurtful without thinking.
  - **[2] 补得更完整**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > After apologizing, we actually got closer and started talking more openly than before.


**B1 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

### 输入 B2（Part 2·放松的地方·full）
**题面**：Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.

**中文语料**：我最喜欢去的地方是家附近一个不大的公园，走路十分钟就到，我基本每天傍晚都会去。我一般什么也不干，就沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗的和跑步的人。那儿有一排很老的柳树，风一吹特别安静。忙了一天之后去那儿走走，脑子里乱七八糟的事好像慢慢就理顺了，整个人会松下来。比起在家躺着刷手机，我觉得那种放空反而更解乏。

**run1**：
  - **[0] 交代背景**（14词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home, and I go there almost every evening.
  - **[1] 讲清重点**（29词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✗ H7✓）
    > I just walk slowly around the lake with headphones on, listening to music and watching people — it’s quiet, especially when the wind blows through the old willow trees.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）

**run2**：
  - **[0] 交代背景**（19词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home — I walk there in ten minutes, and I go almost every evening.
  - **[1] 讲清重点**（34词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✗ H7✓）
    > I just walk slowly around the lake with headphones on, listening to music and watching people walk their dogs or jog — and the old willow trees swaying in the wind make it super quiet.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）


**B2 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

### 输入 B2thin（Part 2·放松的地方(薄素材·21字)·thin）
**题面**：Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.

**中文语料**：我喜欢去我家附近的一个公园放松，感觉挺好的。

**run1**：
  - **[0] 交代背景**（10词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I go to a park near my home pretty often.
  - **[1] 讲清重点**（18词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I just sit on a bench and watch people or listen to birds — it’s quiet and peaceful.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）

**run2**：
  - **[0] 交代背景**（11词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I usually go to a park near my home to relax.
  - **[1] 讲清重点**（15词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > I just sit on a bench and watch people walk by — it's quiet and calm.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）


**B2thin 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

### 输入 B2-40（Part 2·放松的地方(中薄·40字)·thin）
**题面**：Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.

**中文语料**：我喜欢去我家附近的一个小公园，每天傍晚都会去，沿着湖边慢慢走一圈，戴着耳机听点歌，挺放松的。

**run1**：
  - **[0] 交代背景**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home, and I go there every evening.
  - **[1] 讲清重点**（20词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I walk slowly around the lake with headphones on, listening to music, and the quiet vibe really helps me unwind.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）

**run2**：
  - **[0] 交代背景**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home, and I go there every evening.
  - **[1] 讲清重点**（20词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I walk slowly around the lake with headphones on, listening to music, and the quiet atmosphere really helps me unwind.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）


**B2-40 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

### 输入 B2-60（Part 2·放松的地方(中薄·60字)·thin）
**题面**：Describe a place you like to go to relax. You should say: where it is, how often, what you do there, and why it helps you relax.

**中文语料**：我喜欢去我家附近的一个小公园，走路十分钟，每天傍晚都会去，沿着湖边慢慢走，戴耳机听歌，看看遛狗和跑步的人，那儿很安静，挺放松的。

**run1**：
  - **[0] 交代背景**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home, and I go there every evening.
  - **[1] 讲清重点**（23词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✗ H7✓）
    > I walk slowly along the lake, listen to music with headphones, and watch people walking their dogs or jogging — it's quiet and calming.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）

**run2**：
  - **[0] 交代背景**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > It's a small park near my home, and I go there every evening.
  - **[1] 讲清重点**（23词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✗ H7✓）
    > I walk slowly along the lake, listen to music with headphones, and watch people walking their dogs or jogging—it's quiet and calming.
  - **[2] 补得更完整** ⬜ 留空（noMaterial）


**B2-60 判分**（人填）：忠料事实层 ☐　对点 ☐　口语 ☐　中式 ☐　留空恰当 ☐

---

## Part 3（无语料，审论据贴合+常识）

### 输入 C1（Part 3·讨论题）
**题面**：Do you think people apologize enough these days?

**run1**：
  - **[0] 表明立场**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I think people actually apologize less than before.
  - **[1] 讲清理由**（15词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Many just say 'sorry' quickly to end an argument, not because they truly mean it.
  - **[2] 延伸对比**（20词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > Back in the day, people often wrote handwritten notes or waited to speak face-to-face—now a quick text feels enough.

**run2**：
  - **[0] 表明立场**（8词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > I think people actually apologize less than before.
  - **[1] 讲清理由**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > So many just say 'sorry' quickly without meaning it or changing their behavior.
  - **[2] 延伸对比**（20词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓ H7✓）
    > Back then, an apology often meant taking real responsibility — now it’s sometimes just a way to end the conversation.


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
    > Yes, I strongly believe old buildings should be protected.
  - **[1] 讲清理由**（13词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > They carry stories and memories that help people feel connected to their community.
  - **[2] 延伸对比**（20词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓ H7✓）
    > Of course, some old buildings aren’t safe or practical anymore, so we need to balance preservation with real needs.


**C2 判分**（人填）：论据贴合 ☐　常识不离谱 ☐　对点 ☐　口语 ☐　中式 ☐

---
