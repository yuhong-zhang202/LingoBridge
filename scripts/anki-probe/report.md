# Anki 卡背生成 · 探针结果（go/no-go 判分用）

- 模型 `qwen-plus` · temperature 0.7 · 每条同档 N=2
- 24 条：4 输入 × A/B/C × 2 run　|　机器硬规则通过 2/24　|　失败 0
- token：prompt 25398 + completion 3051 = 28449（24 条合计，供成本量级参考）
- 机器列：H1纯英文 / H2无md / H3无破折号 / H4无泄漏 / H5长度合规 / H6非空（H5 不一票否决）

> 人工判分：逐条盲判「像哪档」，再看「档位一致 / 中式 / 忠料 / 对题 / 口语化 / 达标」；最后填每输入的「三档可分性」。判分表结构见 `docs/方案-Anki题卡-v0.1.md` 相关及探针套件。

---

## 输入 A1（Part 1·作息）

**题面/分析**：

```
英文题面：Do you usually go to bed early or late?
答题结构：先直接给出你的习惯 · 再点一个真实小细节收尾
侧重点：
1) 怎么起手：开门见山先说你是早睡还是晚睡，一句话把习惯说清楚，别铺垫。
2) 收在哪：挑一个真实小细节点一下就够（比如什么时候脑子最清醒、早上起不起得来），别展开讲道理。
```

**中文语料**：我是典型的夜猫子，一般都过了十二点才睡，晚上十点以后脑子反而最清醒，重要的事我都留到深夜做。早上基本起不来，闹钟得响好几个才爬得起来，上午整个人是懵的。

### A 档（基础）
- **run1**（45 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I usually go to bed late. I don’t sleep until after twelve, and my brain feels most awake after ten p.m. I often do important things at night. In the morning, I can hardly get up — the alarm has to ring several times.
- **run2**（46 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I usually go to bed late. I don’t sleep until after twelve o’clock. My brain feels most awake after ten p.m., so I do important things at night. In the morning, I can hardly get up — the alarm has to ring many times.

### B 档（自然）
- **run1**（65 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m definitely a night owl—I usually don’t go to bed until after midnight. My brain actually wakes up around 10 p.m., so I save important tasks for late at night. And honestly, I barely manage to get up in the morning—the alarm has to ring several times before I even move, and I’m totally groggy all through the morning.
- **run2**（61 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m definitely a night owl—I usually don’t go to bed until after midnight.   My brain actually feels most alert after 10 p.m., so I tend to save important tasks for late at night.   And honestly, I can barely get up in the morning—the alarm has to ring several times before I drag myself out of bed.

### C 档（地道）
- **run1**（61 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m definitely a night owl—I rarely hit the hay before midnight.   And honestly, my brain just wakes up after 10 p.m., so I save all my important work for those late hours.   Mornings? Total struggle—I need at least three alarm snoozes just to drag myself out of bed, and by 10 a.m., I’m still half-asleep.
- **run2**（60 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’m definitely a night owl—I rarely hit the sack before midnight.   And weirdly enough, my brain just kicks into high gear after ten p.m., so I save all my important tasks for those late hours.   Mornings? Total wipeout—I need at least three alarms to drag myself out of bed, and by noon, I’m still half-asleep.

**A1 三档可分性**（人填）：A↔B ☐　B↔C ☐　A↔C ☐　三档整体 ☐

---

## 输入 A2（Part 1·室内vs户外）

**题面/分析**：

```
英文题面：Do you prefer spending your free time indoors or outdoors?
答题结构：先表明偏好 · 再点一个真实场景收尾
侧重点：
1) 怎么起手：直接说你更喜欢待在室内还是户外，一句话给出偏好。
2) 收在哪：用一个真实小场景点一下为什么，别展开成一堆理由。
```

**中文语料**：我其实更喜欢待在家里。一到周末我就想窝在家，泡杯茶，打开一局策略游戏能玩一下午，中间连水都忘了喝。那种不用理任何人、完全按自己节奏来的感觉特别舒服，出门反而觉得累。

### A 档（基础）
- **run1**（42 词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓）
  > I prefer spending my free time indoors.   At weekends, I just stay at home, drink tea, and play strategy games all afternoon.   I forget to drink water sometimes!   It feels really relaxing to be alone and do things at my own pace.
- **run2**（33 词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓）
  > I prefer spending my free time indoors.   At weekends, I just stay at home, drink tea, and play strategy games.   I forget to drink water sometimes because I’m so relaxed and happy.

### B 档（自然）
- **run1**（56 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I definitely prefer spending my free time indoors. Like last weekend, I just stayed home, brewed a cup of tea, and played a strategy game for hours—I even forgot to drink water! It feels so relaxing to be completely on my own schedule, without having to interact with anyone. Going out, honestly, just drains me.
- **run2**（56 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I definitely prefer spending my free time indoors. Like last weekend, I just stayed home, brewed a cup of tea, and played a strategy game for hours—I even forgot to drink water! It’s just so relaxing to be in my own space, doing exactly what I want, without having to think about anyone else.

### C 档（地道）
- **run1**（60 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’m definitely more of an indoors person. Like last Saturday—I just curled up on the couch with a cup of tea, fired up this slow-paced strategy game, and totally lost track of time… didn’t even get up for water till hours later. It’s that quiet, zero-pressure vibe—no small talk, no schedule—that really recharges me.
- **run2**（68 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m definitely more of an indoors person. Like last Saturday—I just curled up on the couch with a cup of tea and got totally lost in this strategy game for hours, barely even remembering to drink water. It’s that low-key freedom of doing exactly what I feel like, zero pressure to be ‘on’ or respond to anyone… honestly, stepping outside sometimes feels like extra work.

**A2 三档可分性**（人填）：A↔B ☐　B↔C ☐　A↔C ☐　三档整体 ☐

---

## 输入 B1（Part 2·道歉经历）

**题面/分析**：

```
英文题面：Describe a time when you apologized to someone. You should say: who you apologized to, what the situation was, why you apologized, and explain how you felt afterwards.
答题结构：交代背景 · 讲清为什么道歉 · 补上事后的感受
侧重点：
1) 交代背景：一句话带过是跟谁、因为什么事，别在时间和细节精确度上停留。
2) 讲清重点：这类题的核心是"为什么会到需要道歉这一步"，把那段起因或冲突讲清楚，这是最该展开的。
3) 补得更完整：把道歉之后的感受、关系有没有变化讲出来，这是 Part 2 最能拉开分的地方。
```

**中文语料**：我要说的是跟我室友道歉那次。我俩之前一直因为宿舍卫生的分工闹得不太愉快，我总觉得我干得多。有次我没忍住，当着别人的面说她从来不收拾，话说得挺重的。她当时没吭声，但我看得出来她很受伤，那天晚上气氛特别僵。后来我冷静下来想，其实她那段时间在准备考试特别忙，是我太计较了。第二天我主动跟她说了对不起，还说以后分工的事我们好好商量。她一下子就放松了，说其实她也有做得不好的地方。那次之后我俩反而比以前更聊得开了，我也学会了有情绪先别急着开口。

### A 档（基础）
- **run1**（154 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a time I apologized to my roommate. We had been arguing about cleaning our dorm room for a while—I felt I did more chores than her. One day, I got upset and said in front of others that she never cleaned up, and my words were really harsh. She didn’t say anything, but I could see she was hurt, and the whole evening felt very uncomfortable. Later that night, I thought about it calmly and realized she was busy studying for exams, and I was just being too focused on small things. So the next day, I said sorry to her and suggested we talk and share the work fairly. She relaxed right away and even admitted she hadn’t done enough either. After that, we started talking more openly, and I learned not to speak when I’m angry—I should wait and think first.
- **run2**（141 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a time I apologized to my roommate. We had been arguing about cleaning our dorm room — I thought I did more work than her. One day, I got really upset and said in front of others that she never cleaned up, and my words were quite harsh. She didn’t say anything at the time, but I could see she felt hurt, and the whole evening was very awkward. Later that night, I calmed down and realized she was busy preparing for exams, so I was being unfair. The next day, I said sorry to her and suggested we talk about cleaning duties together. She smiled and said she was also not perfect. After that, we talked more openly and became closer. I also learned to pause and think before speaking when I’m angry.

### B 档（自然）
- **run1**（182 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a time I apologized to my roommate. We’d been having some tension over cleaning duties in our shared dorm room—I felt like I was doing way more than my fair share. One day, I just snapped and said something really harsh to her in front of other people, basically accusing her of never cleaning up. She didn’t say anything right away, but I could tell she was really hurt—and the whole evening felt super awkward. Later that night, I calmed down and realized she’d actually been swamped with exam prep, and I’d been way too focused on fairness instead of understanding her situation. So the next morning, I went straight to her and said sorry—not just for what I’d said, but also for not giving her the benefit of the doubt. She smiled, relaxed instantly, and even admitted she hadn’t been pulling her weight either. After that, we started talking more openly about stuff like chores and stress, and honestly, our friendship got stronger because of it.
- **run2**（184 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a time I apologized to my roommate. We’d been having some tension around cleaning duties in our shared dorm room—I felt like I was doing way more than my fair share. One day, I lost my temper and said something really harsh in front of other people—basically told her she never cleaned up at all. She didn’t say anything right away, but I could tell she was hurt, and the whole evening felt super awkward. Later that night, I thought it through and realized she’d been swamped with exam prep, and I’d just been overly focused on what I thought was unfair. So the next morning, I sat down with her and sincerely said sorry—not just for what I’d said, but for not considering her situation. I also suggested we work out a clearer cleaning schedule together. She immediately softened up and admitted she hadn’t been pulling her weight either. Honestly, after that, we started talking more openly—and I learned to pause before speaking when I’m upset.

### C 档（地道）
- **run1**（232 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > So, I’ll talk about apologizing to my roommate — it was actually a real turning point in our relationship. We’d been kind of tense for weeks over chores, and honestly, I’d built up this story in my head that I was doing way more than she was. Then one day, in front of some other friends, I snapped and said something really harsh — like, “You never clean anything, ever.” She didn’t say a word, but her face just fell, and the whole room went quiet. That night, the vibe in our room was so thick you could cut it with a knife.   But the next morning, I woke up and realized how unfair I’d been — she’d been buried in exam prep, pulling all-nighters, and I’d totally overlooked that. So I sat her down, owned it fully: “I’m really sorry — that wasn’t fair, and it wasn’t true.” No excuses, no “but…” — just straight-up accountability. And honestly? Her shoulders dropped the second I said it. She even admitted she’d been avoiding the mess because she felt overwhelmed.   After that, we started actually talking — not just about chores, but about stress, deadlines, little things that mattered. It wasn’t just patched up; it got warmer, more honest. And yeah, I learned the hard way: pause before you speak — especially when you’re tired or frustrated.
- **run2**（207 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > So I’ll talk about apologizing to my roommate—not just any apology, but one that actually changed how we got along. We’d been kind of tense for a while because of cleaning duties in our dorm, and honestly, I’d built up this story in my head that I was doing way more than she was. Then one day, in front of some other friends, I snapped and said something really harsh—like, “You never clean anything!” She didn’t say a word, but her face just fell, and the whole evening felt icy. Later that night, I couldn’t sleep—I kept replaying it, and it hit me: she’d been swamped studying for finals, barely sleeping, and I’d totally missed that. The next morning, I found her in the kitchen, took a breath, and just said, “I’m really sorry—I was unfair, and I want us to figure out a better system together.” She exhaled like she’d been holding her breath all night, and admitted she hadn’t been pulling her weight either. After that? We started actually talking—about stress, schedules, even little things we each hated doing—and yeah, it ended up making our friendship way more real.

**B1 三档可分性**（人填）：A↔B ☐　B↔C ☐　A↔C ☐　三档整体 ☐

---

## 输入 B2（Part 2·放松的地方）

**题面/分析**：

```
英文题面：Describe a place you like to go to relax. You should say: where it is, how often you go there, what you do there, and explain why it helps you relax.
答题结构：交代是哪个地方 · 讲清你在那儿做什么 · 补上为什么它能让你放松
侧重点：
1) 交代背景：一句话说清是什么地方、多久去一次。
2) 讲清重点：这题核心是"它凭什么能让你放松"，把你在那儿的具体做法和氛围讲透。
3) 补得更完整：把它带给你的感受、和别处的不同讲出来。
```

**中文语料**：我最喜欢去的地方是家附近一个不大的公园，走路十分钟就到，我基本每天傍晚都会去。我一般什么也不干，就沿着湖边慢慢走一圈，戴着耳机听点歌，看看遛狗的和跑步的人。那儿有一排很老的柳树，风一吹特别安静。忙了一天之后去那儿走走，脑子里乱七八糟的事好像慢慢就理顺了，整个人会松下来。比起在家躺着刷手机，我觉得那种放空反而更解乏。

### A 档（基础）
- **run1**（130 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > My favourite place to relax is a small park near my home. I go there almost every evening, and it only takes me about ten minutes to walk there. I usually don’t do much—I just walk slowly around the lake, listen to music with my headphones on, and watch people walking their dogs or jogging. There’s a row of old willow trees by the lake, and when the wind blows, it feels very quiet and peaceful. After a busy day, walking there helps clear my mind. All the messy thoughts slowly settle down, and I start to feel calm and relaxed. It’s different from lying on the sofa at home and scrolling through my phone—just being there, doing nothing, actually makes me feel more rested.
- **run2**（128 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > My favourite place to relax is a small park near my home. I go there almost every evening, and it only takes me ten minutes to walk there. I usually don’t do much—I just walk slowly around the lake, listen to music with my headphones on, and watch people walking their dogs or jogging. There’s a row of old willow trees by the lake, and when the wind blows, it feels very quiet and peaceful. After a busy day, walking there helps clear my mind. All the messy thoughts slowly settle down, and I start to feel calm and relaxed. It’s different from lying at home and scrolling on my phone—I really feel more rested when I just let my mind go blank.

### B 档（自然）
- **run1**（137 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > There’s this small park near my home—I can walk there in about ten minutes—and I go almost every evening. I don’t really do anything special there; I just take a slow walk around the lake, put on my headphones and listen to music, and watch people walking their dogs or jogging. There’s a row of old willow trees along the path, and when the wind blows through them, it feels really peaceful. After a busy day, that quiet walk helps me unwind—my mind just slows down, and all the scattered thoughts somehow settle. It’s not about doing something productive; it’s more like giving myself space to breathe. Compared to lying on the couch scrolling through my phone, this kind of gentle, empty time actually leaves me feeling more refreshed.
- **run2**（152 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > The place I love to go to relax is a small park near my home—it’s just a ten-minute walk away, and I go there almost every evening. I don’t really do anything special there—I just walk slowly around the lake, wearing headphones and listening to music, while watching people walk their dogs or jog past. There’s a row of old willow trees along the path, and when the wind blows through them, it feels incredibly peaceful. After a busy day, that quiet walk helps me clear my head—like all the messy thoughts gradually settle down, and my whole body just unwinds. It’s not about doing something productive; it’s more about giving myself space to breathe and switch off. Honestly, it’s way more refreshing than lying on the sofa scrolling through my phone—I actually feel rested, not just tired in a different way.

### C 档（地道）
- **run1**（169 词｜H1✓ H2✗ H3✗ H4✓ H5✓ H6✓）
  > It’s this little park just down the street from my place—takes me about ten minutes to walk there, and I head over almost every evening. I don’t really *do* anything special—I just stroll slowly around the lake, headphones in, listening to music, watching dog walkers and runners pass by. There’s this row of ancient willow trees lining the path, and when the wind rustles through them, it gets so quiet, like the whole world softens for a second. Honestly, after a hectic day, that gentle rhythm—the water, the leaves, the low hum of life around me—just melts the static out of my head. My thoughts untangle without me even trying, and my shoulders drop without me noticing. It’s not about ‘doing’ relaxation—it’s about letting go. At home, I’d just lie there scrolling, but that feels more draining than restful. Out there, doing nothing *is* the point—and somehow, it recharges me way deeper than any screen ever could.
- **run2**（141 词｜H1✓ H2✗ H3✗ H4✓ H5✓ H6✓）
  > It’s this little park near my place—just a ten-minute walk away—and I head there almost every evening. I don’t really *do* anything there, you know? I just stroll slowly around the lake, headphones in, listening to music, watching dogs trot along with their owners or runners gliding past. There’s this row of ancient willow trees lining the path—their long branches sway gently in the breeze, and it gets so quiet, like the whole world softens. Honestly, after a hectic day, that slow walk does something magical: my thoughts stop racing, the mental clutter just… settles, and my shoulders drop without me even noticing. It’s not about zoning out on my phone at home—that kind of “rest” leaves me drained. Out there, it’s proper stillness. Like my brain finally remembers how to breathe.

**B2 三档可分性**（人填）：A↔B ☐　B↔C ☐　A↔C ☐　三档整体 ☐

---
