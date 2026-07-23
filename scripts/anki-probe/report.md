# Anki 卡背生成 · 探针结果（go/no-go 判分用）

- 模型 `qwen-plus` · temperature 0.7 · 每条同档 N=2
- 24 条：4 输入 × A/B/C × 2 run　|　机器硬规则通过 3/24　|　失败 0
- token：prompt 42054 + completion 3033 = 45087（24 条合计，供成本量级参考）
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
- **run1**（46 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I usually go to bed late, after midnight. My mind feels most awake after ten p.m., so I do important things at night. I can’t get up early—I need my alarm to ring several times. In the morning, I feel kind of foggy.
- **run2**（46 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I usually go to bed late, after midnight. My mind feels most awake after ten p.m., so I do important things at night. I can’t get up early—I need my alarm to ring several times. In the morning, I feel kind of foggy.

### B 档（自然）
- **run1**（64 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I'm definitely a night owl—I usually don't go to bed until after midnight. My mind actually feels sharpest after ten p.m., so I save important tasks for those late hours. And honestly, I can barely get up in the morning—the alarm has to ring several times before I drag myself out of bed, and I'm totally foggy all through the morning.
- **run2**（65 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I'm definitely a night owl—I usually don't go to bed until after midnight. My mind actually feels sharpest after ten p.m., so I save important tasks for late at night. And honestly, I struggle to get up in the morning—the alarm has to ring several times before I can drag myself out of bed, and I'm pretty foggy all through the morning.

### C 档（地道）
- **run1**（59 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’m a total night owl—I rarely hit the hay before midnight. My brain actually wakes up after ten p.m., so I save all my important tasks for late at night. And yeah, mornings? I’m basically running on autopilot—my alarm has to go off three times before I even think about getting out of bed.
- **run2**（69 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m a total night owl—I usually don’t hit the hay until after midnight. My brain actually wakes up around ten p.m., so I save all my important tasks for late at night. And yeah, mornings? I barely drag myself out of bed—my alarm has to go off three times before I even open my eyes, and I’m basically running on autopilot till lunchtime.

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
- **run1**（47 词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓）
  > I prefer spending my free time indoors. I usually stay at home on weekends, make a cup of tea, and play a strategy game for hours. I even forget to drink water sometimes. It feels really comfortable to be alone and do things at my own pace.
- **run2**（47 词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓）
  > I prefer spending my free time indoors. I usually stay at home on weekends, make a cup of tea, and play a strategy game for hours. I even forget to drink water sometimes. It feels really comfortable to be alone and do things at my own pace.

### B 档（自然）
- **run1**（56 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I actually prefer spending my free time indoors. Like last weekend, I just stayed home, brewed a cup of tea, and played a strategy game for hours—I even forgot to drink water. It feels so relaxing to be completely on my own schedule, without having to interact with anyone. Going out, honestly, just drains me.
- **run2**（61 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I actually prefer spending my free time indoors. At weekends, I love staying at home, brewing a cup of tea and playing a strategy game for hours—I even forget to drink water sometimes. It just feels so relaxing to be completely on my own schedule, with no need to interact with anyone, and going out honestly leaves me feeling tired.

### C 档（地道）
- **run1**（69 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m definitely more of an indoors person. Last weekend, I totally unplugged at home—brewed a cup of tea, fired up a strategy game, and just lost track of time for hours, barely even remembering to drink water. It’s that low-key freedom of doing exactly what I want, when I want, without anyone else’s schedule or energy draining me. Going out? Honestly, it feels like work.
- **run2**（67 词｜H1✓ H2✓ H3✗ H4✓ H5✗ H6✓）
  > I’m definitely more of an indoors person. Like last Saturday—I just curled up at home with a cup of tea and got totally lost in this strategy game for hours, barely even remembered to drink water. It’s that feeling of zero pressure, zero expectations, just doing my own thing at my own pace—it’s pure bliss. Going out? Honestly, it just drains me.

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
- **run1**（143 词｜H1✓ H2✓ H3✓ H4✓ H5✓ H6✓）
  > I want to talk about a time I apologized to my roommate. We had some problems with cleaning our dorm room. I thought I did more cleaning than her. One day, I got upset and said in front of others that she never cleaned up. My words were quite harsh. She didn’t say anything, but I could see she felt hurt. The atmosphere was very tense that night. Later, I calmed down and realized she was busy with exams at that time. I was too focused on the cleaning and forgot her situation. So the next day, I said sorry to her. I also said we should talk and decide cleaning duties together. She relaxed right away and said she also had things to improve. After that, we talked more openly. I also learned not to speak quickly when I feel angry.
- **run2**（136 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I want to talk about apologizing to my roommate. We lived together and had some problems about cleaning our dorm room. I thought I did more cleaning than her, so I got upset. One day, I said something harsh in front of other people — I told her she never cleaned anything. She didn’t say anything, but I could see she felt hurt. The whole evening was very awkward. Later, I calmed down and realized she was busy with exams at that time. I was too focused on myself. The next day, I said sorry to her. I also said we should talk and decide cleaning tasks together. She relaxed right away and admitted she hadn’t done enough either. After that, we talked more openly. I learned to pause before speaking when I’m angry.

### B 档（自然）
- **run1**（196 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a time I apologized to my roommate. We’d been having some tension over cleaning duties in our dorm—basically, I felt like I was doing way more than she was. One day, I lost my temper and said something really harsh in front of other people: I told her she never cleaned up at all. She didn’t say anything right away, but I could tell she was hurt—the whole evening felt super awkward. Later that night, I thought about it calmly and realized she’d actually been swamped with exams, and I’d just been too focused on what I thought was unfair. So the next morning, I went straight to her and said sorry—not just for the words, but for not considering her situation. I also suggested we sit down and work out a fairer cleaning schedule together. She smiled, relaxed right away, and even admitted she hadn’t been great about keeping up either. After that, we started talking more openly, and honestly, our relationship got stronger. I also learned to pause before speaking when I’m upset—it’s made a real difference.
- **run2**（180 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a time I apologized to my roommate. We’d been having some tension over cleaning duties in our shared dorm room—I felt like I was doing way more than my fair share. One day, I lost my temper and said something really harsh in front of other people: I told her she never cleaned up at all. She didn’t say anything right then, but I could tell she was hurt, and the whole evening felt super awkward. Later that night, I thought about it calmly and realized she’d actually been swamped with exams—she wasn’t ignoring chores, she was just overwhelmed. So the next morning, I went to her and sincerely said sorry, and suggested we sit down together to figure out a fairer cleaning schedule. She immediately softened, admitted she hadn’t communicated well either, and even thanked me for bringing it up. After that, our communication got much easier—we started checking in with each other more, and I learned to pause before speaking when I’m upset.

### C 档（地道）
- **run1**（194 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about apologizing to my roommate a while back. We’d been kind of at odds over cleaning duties in our shared dorm room—I felt like I was doing way more than my fair share. Then one day, I lost my cool and said something harsh right in front of other people: “You never clean up anything!” She didn’t say a word, but her face just fell, and the whole evening felt icy. Later that night, I couldn’t stop thinking about it—and realized she’d actually been swamped with exams, barely sleeping, and I’d totally overlooked that. So the next morning, I sat down with her, owned up to it, and said, “I’m really sorry—I shouldn’t have spoken like that, especially in front of others.” I also suggested we map out a fairer cleaning schedule together. She visibly relaxed, smiled, and admitted she hadn’t been pulling her weight either. Honestly, that apology didn’t just fix things—it opened the door for way more honest chats. And ever since, I’ve tried to pause before blurting out when I’m frustrated.
- **run2**（201 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’ll talk about apologizing to my roommate last semester. We’d been kind of stuck in this loop over cleaning duties—like, who washed the dishes, who took out the trash—and I kept feeling like I was doing way more than my share. Then one day, totally fed up, I snapped and said something harsh right in front of our other flatmate: “You never clean anything!” She didn’t say a word, but her face just fell, and the whole evening felt icy. Later that night, I replayed it in my head and realized she’d been buried in exam prep for weeks—I’d completely missed that. So the next morning, I knocked on her door, owned up to it, and said, “I’m really sorry—I shouldn’t have said that, especially not in front of someone else.” She let out this big sigh, smiled faintly, and admitted she hadn’t been pulling her weight either. Honestly? That apology didn’t just fix things—it cracked open this whole new level of honesty between us. We started actually talking through stuff instead of letting it fester, and yeah, I learned the hard way: pause before you vent.
- C/B 长度比：run1 ×1.03　run2 ×1.07（红线 ≤1.15，B 档均值 188.0 词）

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
- **run1**（125 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > It’s a small park near my home. I walk there every evening, about ten minutes. I don’t do much—I just walk slowly around the lake, listen to music on my headphones, and watch people walking their dogs or jogging. There’s a row of old willow trees by the lake, and when the wind blows, it feels very quiet. After a busy day, walking there helps me slow down. My mind slows down too, and all the messy thoughts kind of settle. I feel relaxed and calm. At home, I usually lie on the sofa and scroll through my phone, but that doesn’t really refresh me. Just being there, doing nothing, feels better. It’s simple, but it works for me.
- **run2**（128 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > It’s a small park near my home. I walk there in about ten minutes, and I go almost every evening. I don’t do much—I just walk slowly around the lake, listen to music on my headphones, and watch people walking their dogs or jogging. There’s a row of old willow trees by the lake, and when the wind blows, it feels very quiet. After a busy day, walking there helps me slow down. My mind slows down too, and all the messy thoughts kind of settle. I feel more relaxed. At home, I usually lie on the sofa and scroll through my phone, but that doesn’t really refresh me. Here, just being still and watching things happen around me makes me feel lighter.

### B 档（自然）
- **run1**（137 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I usually go to a small park near my home—it’s just a ten-minute walk away, and I visit almost every evening. I don’t really do anything special there—I just walk slowly around the lake, listen to music on my headphones, and watch people walking their dogs or jogging. There’s a row of old willow trees by the water, and when the wind blows through them, it feels really peaceful. After a busy day, walking there helps clear my head—those scattered thoughts gradually settle down, and my body and mind just relax. It’s not like lying on the sofa scrolling through my phone; instead, I actually feel empty in a good way—like my brain gets a proper break. That quiet, simple rhythm is what makes it so refreshing for me.
- **run2**（141 词｜H1✓ H2✓ H3✗ H4✓ H5✓ H6✓）
  > I’d like to talk about a small park near my home—it’s only a ten-minute walk away, and I go there almost every evening. I don’t really do anything special there—I just walk slowly around the lake, wearing headphones and listening to music, while watching people walk their dogs or go for a run. There’s a row of old willow trees by the water, and when the wind blows, everything feels really quiet and still. After a busy day, that short walk helps me unwind: my mind slows down, and all the scattered thoughts somehow start to settle. I feel lighter, calmer—like my body and brain finally get to rest. It’s different from lying on the sofa at home scrolling through my phone; here, doing nothing on purpose actually leaves me feeling more refreshed.

### C 档（地道）
- **run1**（179 词｜H1✓ H2✗ H3✗ H4✓ H5✓ H6✓）
  > I’ve got this little park just down the street from my place—ten minutes on foot—and I hit it almost every evening without fail. I don’t really *do* anything there, not in the usual sense: no workout, no agenda—just stroll slowly around the lake, headphones in, listening to whatever’s on shuffle, watching dog walkers and joggers pass by. There’s this row of ancient willow trees lining the water, and when the wind picks up, their branches sway so gently that everything else just fades into the background. Honestly, after a long day, that walk does something quiet but real—it untangles the mental knots, slows my mind down, and lets my shoulders drop without me even noticing. It’s not about zoning out like I do scrolling at home; it’s more like my brain finally remembers how to breathe. That kind of stillness? You can’t get it anywhere else—not in my apartment, not online, not even with friends. It’s just me, the lake, and those willows doing their thing.
- **run2**（149 词｜H1✓ H2✗ H3✗ H4✓ H5✓ H6✓）
  > It’s this little park near my place—just a ten-minute walk away—and I head there almost every evening. I don’t really *do* anything special: I just stroll slowly around the lake, pop in my earbuds, play some low-key music, and watch people—dog walkers, joggers, kids chasing pigeons. There’s this row of ancient willow trees lining the path, and when the wind rustles through them, it gets so quiet, like the whole world takes a breath. After a hectic day, that slow walk does something to me—it doesn’t fix anything, but it untangles the mental static, you know? My thoughts settle, my shoulders drop, and I just… reset. It’s not about zoning out with my phone at home; it’s about showing up empty-handed and walking back feeling lighter, like I’ve hit pause on the noise and actually *landed* somewhere real.
- C/B 长度比：run1 ×1.29 ⚠️　run2 ×1.07（红线 ≤1.15，B 档均值 139.0 词）

**B2 三档可分性**（人填）：A↔B ☐　B↔C ☐　A↔C ☐　三档整体 ☐

---
