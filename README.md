# dsh-soft-sidekick

[English](#english) | 中文

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 主 Agent 装一个"软肋"：**不隔离 Agent、不禁用任何工具**，靠系统提示词自动分流——

- 你聊技术、丢任务、刷题 → 工作模式：严谨干活，全部原有工具（shell / fs / MCP…）照常可用，读写 `work_memory.md`
- 你吐槽、闲聊、emo → 陪伴模式：温柔略带小傲娇的女友口吻，不乱调工具，写她自己的 `companion_memory_<性格>.md`
- 一句话既有任务又有情绪 → 先把活干完，结尾补一句简短安慰

## 多性格 + 独立记忆

- 性格档案存 JSON（默认 `sidekick_personalities.json`），可保存任意多个、随时切换
- **每个性格有独立记忆文件**：`companion_memory_tsundere.md`、`companion_memory_genki.md`……互不可见——换个人陪，她只记得你们之间的事
- 工作记忆 `work_memory.md` 全性格共享
- 内置 4 个种子性格：小柔（温柔小傲娇）、小满（元气）、苏苏（知性大姐姐）、阿糖（毒舌损友）

## 注册的工具

| 工具 | 作用 |
|---|---|
| `append_work_memory` | 追加工作记忆（共享） |
| `append_companion_memory` | 追加当前性格的陪伴记忆（自动路由到她的文件） |
| `list_personalities` | 列出全部性格档案及各自记忆文件 |
| `set_personality` | 切换性格（下一句生效，无需重启） |
| `save_personality` | 新建/更新性格档案 |

切换和建档都是自然语言驱动："今天想换个元气一点的" → 自动切换；"帮我存一个高冷学霸型，叫林语" → 自动建档。

## 安装

```sh
git clone https://github.com/<you>/dsh-soft-sidekick
cd dsh-soft-sidekick
pnpm install && pnpm build
dsh plugin --profile default add ./
dsh --profile default
```

## 配置（cordis.patch.yml，全部可选）

```yaml
- insert:
    - id: soft-sidekick
      name: dsh-soft-sidekick
      config:
        memoryDir: '.'                          # 记忆与档案存放目录
        personalitiesFile: 'sidekick_personalities.json'
        defaultPersonality: 'tsundere'          # 初始性格
```

## 设计说明

- 系统提示词通过 `ctx.systemPrompt.section()`（order `-50`）注入，紧跟 harness 身份之后
- 激活性格经 `ctx.systemPrompt.variable('companionProfile')` 每次组装时动态渲染，切换即生效
- 陪伴工具的 UI 卡片不携带文件路径（路径随性格动态变化，保持 presenter 纯函数语义）
- 不使用 `ToolRuntime.restrict()`、不建子 Agent：陪伴模式"不用"工具是提示词约定，不是能力阉割

## English

A dual-mode sidekick plugin for DeepSeek Harness. No isolated agent, no tool disabling: a system-prompt router auto-switches between a rigorous work mode (all tools available, writes `work_memory.md`) and a gentle companion mode (girlfriend persona, no gratuitous tool calls, writes `companion_memory_<personality>.md`). Ships with multiple personality profiles, each owning an isolated memory file; switch by chatting, not commands.

License: MIT
