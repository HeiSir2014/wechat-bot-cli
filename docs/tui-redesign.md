# WeChat Bot CLI — TUI 重构方案

## 现状问题

1. **readline Tab 补全体验差** — 每次 Tab 重复打印候选列表，无法 inline 补全
2. **输入与输出混杂** — 长轮询收到消息时覆盖用户正在输入的内容
3. **无布局分区** — 消息流和输入框混在一起，无法回滚历史
4. **无色彩主题** — 颜色硬编码，不统一

## 调研：TUI 框架选型

### 方案 A：Ink（React for CLI）

| 项目 | 说明 |
|------|------|
| 库 | [ink](https://github.com/vadimdemedes/ink) v5 + ink-text-input + ink-select-input |
| 语言 | TypeScript + JSX |
| 原理 | React reconciler 渲染到 terminal，组件式布局 |
| 案例 | [opencode](https://github.com/nicholasgriffintn/opencode), Claude Code TUI, Vercel CLI |
| 优点 | 声明式 UI，组件复用，热更新，社区生态丰富 |
| 缺点 | 依赖 React 运行时（~2MB），JSX 编译需配置 |

### 方案 B：Blessed / Blessed-contrib

| 项目 | 说明 |
|------|------|
| 库 | [blessed](https://github.com/chjj/blessed) |
| 原理 | ncurses 风格的 widget 系统 |
| 优点 | 强大的布局能力，滚动、窗口、弹窗 |
| 缺点 | 维护停滞（最后更新 2017），API 复杂 |

### 方案 C：@clack/prompts + 自定义渲染

| 项目 | 说明 |
|------|------|
| 库 | [@clack/prompts](https://github.com/bombshell-dev/clack) |
| 原理 | 轻量 prompt 工具，单步交互 |
| 优点 | 极轻量，漂亮的默认样式 |
| 缺点 | 不支持持续交互（聊天模式），只能做向导式流程 |

### 方案 D：Raw ANSI + 自渲染（参考 opencode）

| 项目 | 说明 |
|------|------|
| 原理 | 直接操作 ANSI escape codes，自己管理光标和区域 |
| 优点 | 零依赖，完全控制 |
| 缺点 | 工作量大，需要处理终端尺寸变化、Unicode 宽度等 |

### 推荐：方案 A（Ink）

理由：
- opencode 等同类产品已验证该方案
- 声明式 UI 适合聊天应用的状态驱动渲染
- `ink-text-input` 内置 Tab 补全不会重复打印
- 消息流和输入框天然分离（不同 React 组件）
- Bun 原生支持 JSX

## 实现方案

### 整体架构

```
cli.ts (entry)
├── App.tsx              # 根组件，管理全局状态
│   ├── Header.tsx       # 顶部状态栏（account, target, status）
│   ├── MessageList.tsx  # 消息流区域（可滚动）
│   │   ├── UserMessage  # 用户消息（黄色）
│   │   ├── BotMessage   # Bot 消息（绿色）
│   │   └── SystemEvent  # 系统事件（灰色）
│   ├── StatusBar.tsx    # 底部状态栏（context status, raw mode）
│   └── InputBar.tsx     # 输入框 + Tab 补全
│       ├── CommandComplete  # /命令补全
│       └── FileComplete     # 文件路径补全
├── api.ts               # WeChat API 封装（复用 weixin/src/）
├── state.ts             # 全局状态管理
└── theme.ts             # 色彩主题
```

### 屏幕布局

```
┌─────────────────────────────────────────────┐
│ 🤖 WeChat Bot CLI  ▏ 452d4b1b@im.bot       │  ← Header
│ Target: o9cq808a..@im.wechat  ▏ ● Connected │
├─────────────────────────────────────────────┤
│                                             │
│ ◀ o9cq808a..  12:17                         │  ← MessageList
│   你好                                       │
│                                             │
│ ▶ 12:18                                     │
│   hello                                     │
│                                             │
│ ◀ o9cq808a..  12:18                         │
│   📎 gateway.md (10245 bytes)                │
│   → .media-downloads/gateway.md              │
│                                             │
├─────────────────────────────────────────────┤
│ /file  /image  /video  /send  /help         │  ← Tab 补全候选
├─────────────────────────────────────────────┤
│ ❯ hello world_                              │  ← InputBar
└─────────────────────────────────────────────┘
```

### 关键组件设计

#### 1. InputBar — 输入框 + 智能补全

```tsx
// 使用 ink-text-input 自定义版本
// Tab 按下时：
//   - 如果输入以 / 开头：显示命令候选（inline 高亮）
//   - 如果 /file|/image|/video 后接路径：文件路径补全
//   - 单个匹配直接 inline 补全，不打印列表
//   - 多个匹配在 StatusBar 上方短暂显示候选

const InputBar = () => {
  const [value, setValue] = useState("");
  const [completions, setCompletions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.tab) {
      const candidates = getCompletions(value);
      if (candidates.length === 1) {
        setValue(candidates[0]); // inline complete
      } else {
        setCompletions(candidates); // show popup
      }
    }
    if (key.return) {
      handleCommand(value);
      setValue("");
      setCompletions([]);
    }
  });

  return (
    <Box flexDirection="column">
      {completions.length > 1 && <CompletionPopup items={completions} selected={selectedIdx} />}
      <Box>
        <Text color="green">❯ </Text>
        <TextInput value={value} onChange={setValue} />
      </Box>
    </Box>
  );
};
```

#### 2. MessageList — 消息流

```tsx
// 自动滚动到底部
// 支持 Shift+Up/Down 回滚历史
// 不同消息类型不同渲染

const MessageList = ({ messages }: { messages: Message[] }) => {
  return (
    <Box flexDirection="column" flexGrow={1} overflowY="hidden">
      {messages.map((msg, i) => (
        <MessageRow key={i} message={msg} />
      ))}
    </Box>
  );
};

const MessageRow = ({ message }) => {
  const isInbound = message.direction === "in";
  return (
    <Box flexDirection="column" marginY={0}>
      <Text>
        <Text color={isInbound ? "yellow" : "green"}>
          {isInbound ? "◀" : "▶"}
        </Text>
        {" "}
        <Text dimColor>{message.time}</Text>
      </Text>
      <Text>  {message.text}</Text>
      {message.filePath && <Text dimColor>  → {message.filePath}</Text>}
    </Box>
  );
};
```

#### 3. 状态管理

```tsx
// 用 React Context + useReducer 管理全局状态
type AppState = {
  // Connection
  token: string | null;
  accountId: string | null;
  baseUrl: string;
  // Chat
  targetUserId: string | null;
  contextTokens: Record<string, string>;
  messages: Message[];
  // UI
  showRawJson: boolean;
  connectionStatus: "connected" | "polling" | "expired" | "error";
  // Sync
  getUpdatesBuf: string;
};

type Message = {
  direction: "in" | "out" | "system";
  from?: string;
  text: string;
  time: string;
  filePath?: string;
  rawJson?: unknown;
  items?: MessageItem[];
};
```

### 依赖

```json
{
  "dependencies": {
    "@tencent-weixin/openclaw-weixin": "^1.0.3",
    "ink": "^5.0.1",
    "ink-text-input": "^6.0.0",
    "react": "^18.3.1",
    "qrcode-terminal": "^0.12.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0"
  }
}
```

### Bun JSX 配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "baseUrl": ".",
    "paths": {
      "weixin/*": ["./node_modules/@tencent-weixin/openclaw-weixin/*"],
      "openclaw/plugin-sdk": ["./shims/plugin-sdk.ts"]
    }
  }
}
```

### 文件路径补全实现

```tsx
// 不再用 readline completer，而是自己管理状态
// Tab 触发时：
// 1. 解析当前输入，提取 partial path
// 2. readdir 获取候选
// 3. 如果只有一个候选 → 直接替换输入（inline 补全）
// 4. 如果多个候选 → 在输入框上方显示 CompletionPopup
// 5. 再按 Tab → 在候选列表中循环选择
// 6. Enter 或输入其他字符 → 关闭候选列表

const CompletionPopup = ({ items, selected }) => (
  <Box borderStyle="single" borderColor="gray" paddingX={1}>
    {items.map((item, i) => (
      <Text key={item} color={i === selected ? "cyan" : undefined} inverse={i === selected}>
        {" "}{item}{" "}
      </Text>
    ))}
  </Box>
);
```

### QR 码登录页面

```tsx
// 全屏 QR 码 + 状态提示
const LoginScreen = ({ onSuccess }) => {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("requesting");

  useEffect(() => {
    // startWeixinLoginWithQr + waitForWeixinLogin
    // 状态变化: requesting → scanning → scanned → confirmed
  }, []);

  return (
    <Box flexDirection="column" alignItems="center">
      <Text bold>WeChat Bot Login</Text>
      <Newline />
      {qrUrl && <QrCode url={qrUrl} />}
      <Text color="yellow">
        {status === "scanning" && "📱 Scan with WeChat..."}
        {status === "scanned" && "👀 Confirm on phone..."}
        {status === "confirmed" && "✅ Connected!"}
      </Text>
    </Box>
  );
};
```

## 实施计划

### Phase 1：基础 Ink 框架 + 消息收发

1. 安装 ink + react，配置 JSX
2. 实现 `App.tsx`：Header + MessageList + InputBar
3. 迁移现有的 poll 循环和发送逻辑到 React 状态
4. 基础文本输入 + Enter 发送

### Phase 2：Tab 补全

5. 自定义 TextInput 支持 Tab 事件
6. 命令补全（`/` 前缀）
7. 文件路径补全（`/file` 后）
8. CompletionPopup 组件

### Phase 3：QR 登录 + 状态管理

9. LoginScreen 组件（全屏 QR 码）
10. 连接状态指示器
11. 持久化状态 load/save

### Phase 4：打磨

12. 色彩主题系统
13. 消息区域滚动
14. 快捷键（Ctrl+C, Esc, 上下箭头历史）
15. 文件传输进度条

## 参考项目

- [opencode](https://github.com/nicholasgriffintn/opencode) — Ink-based AI coding CLI
- [Claude Code](https://github.com/anthropics/claude-code) — TUI 交互模式
- [ink-text-input](https://github.com/vadimdemedes/ink-text-input) — 文本输入组件
- [pastel](https://github.com/vadimdemedes/pastel) — Ink 应用框架
