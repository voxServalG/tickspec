# OKR

## Objective

建立量化交易信号/策略的声明式描述标准，让策略逻辑与执行层解耦。

用 `.tksp` 文件写策略 → 编译成标准 JSON IR → 下游系统消费执行。

---

## 核心定义

### 信号（Signal）

把原始因子翻译成 [-1, 1] 的情绪分数。不碰钱，不决定买卖，只输出方向性判断。

```
外部因子库 → [factor_a, factor_b] → signal → -1~+1 标量
```

信号内部有两种产出机制：

- **scheduled_checks**：定时轮询（每天/每小时），条件互斥，命中一条就输出对应值。
- **triggers**：实时监控，条件一成立立即覆盖 scheduled 的输出。分电平（持续输出）和脉冲（穿越瞬间单次触发）两种。

类比：信号是温度计。告诉你冷还是热，但不决定穿什么衣服。

### 策略（Strategy）

组合多个信号，决定实际交易动作。输出 operation（target / action / hold）。

```
signals → [signal_a, signal_b, signal_c] → combine(加权) → score → operation
```

策略做了信号做不到的事：

1. **组合**：多个信号按权重合成 score
2. **决策**：根据 score 输出 operation — target（目标仓位）、action（买卖动作）、hold（不动）

类比：策略是穿衣决策。温度计说冷（信号），它决定穿棉袄还是只加件外套（operation）。

### 分层关系

```
因子（外部计算）  →  信号（情绪判断）  →  策略（交易决策）  →  执行层（下单）
   事实层              认知层              决策层              行动层
```

tickspec 只管认知层到决策层的翻译。因子从哪来、订单怎么下，它不关心。

---

## 当前状态与待决事项

### 已完成

- 语言规范定稿（signal / strategy 两种文件类型）
- 解析器完整管线（YAML → AST → 校验 → JSON IR）
- CLI（parse / validate / compile）
- 测试（snapshot + fixture）
- CI（typecheck → lint → test + doclint/codelint）

## 数学与时间序列 OKR

### 设计决策

| 决策点 | 结论 |
|--------|------|
| 语法 | 函数式：`lag(return_1d, 5)`，不用管道或下标 |
| 标量 vs 时间序列 | 类型分开：`number`（标量）和 `series`（时间序列） |
| 多返回值 | 按 series 对待（如 macd 返回 3 个 series） |
| OHLCV | 注册为因子类型即可，数据来源不关心 |
| 文档 | 注册 + 完善记录在 docs/README.md |

---

### KR1：标量数学函数

当前只有 `cross_over()` 和 `clamp()`，需要补充纯标量数学函数。

| 函数 | 签名 | 来源 | 保留理由 |
|------|------|------|----------|
| `abs` | `number → number` | TA-Lib Math Transform | 波动率/幅度计算核心 |
| `sign` | `number → number` | 自定义 | 方向判断 |
| `sqrt` | `number → number` | TA-Lib Math Transform | 波动率计算 |
| `log` | `number → number` | TA-Lib Math Transform (LN) | 收益率计算 |
| `exp` | `number → number` | TA-Lib Math Transform | 连续复利 |
| `min` | `(number, number) → number` | TA-Lib Math Operators | 边界约束 |
| `max` | `(number, number) → number` | TA-Lib Math Operators | 边界约束 |

不纳入：三角函数（对量化信号无意义）、ceil/floor/round（格式化操作，非信号逻辑）、pow（罕见，可由 `exp(n*log(x))` 表达）。

**验收**：validator 白名单注册，类型检查正确，测试覆盖，文档更新。

---

### KR2：时间序列原语

通用滚动/滞后操作，使用函数式语法，返回 series。

| 函数 | 签名 | 语义 | TA-Lib 对应 | 保留理由 |
|------|------|------|-------------|----------|
| `lag` | `(series, n) → series` | n 期前的值 | 无 | 绝对基础 |
| `change` | `(series, n) → series` | `x - x[n]` | MOM | 动量计算核心 |
| `pct_change` | `(series, n) → series` | `x/x[n] - 1` | ROC | 收益率计算核心 |
| `rolling_mean` | `(series, n) → series` | n 期滚动均值 | SMA | 均线，最基础操作 |
| `rolling_std` | `(series, n) → series` | n 期滚动标准差 | STDDEV | 波动率核心 |
| `rolling_min` | `(series, n) → series` | n 期滚动最小值 | MIN | 通道/极值 |
| `rolling_max` | `(series, n) → series` | n 期滚动最大值 | MAX | 通道/极值 |

不纳入：rolling_sum（罕见）、rolling_corr（需双 series 输入，增加类型系统复杂度）。

**验收**：类型系统支持 `series`，validator 白名单注册，测试覆盖，文档更新。

---

### KR3：语义技术指标

行业标准名，封装 TA-Lib 语义。KR3 是便利层——KR2 提供能力，KR3 提供高频指标的语义名称。

| 函数 | 签名 | 语义 | TA-Lib 对应 | 保留理由 |
|------|------|------|-------------|----------|
| `ema` | `(series, n) → series` | 指数移动均线 | EMA | 极高频，均线变体 |
| `rsi` | `(series, n) → series` | 相对强弱指标 | RSI | 极高频，超买超卖 |
| `macd` | `(series, fast, slow, sig) → series` | MACD | MACD | 极高频，趋势跟踪 |
| `bollinger_upper` | `(series, n, k) → series` | 布林带上轨 | BBANDS | 高频，波动率通道 |
| `bollinger_lower` | `(series, n, k) → series` | 布林带下轨 | BBANDS | 高频，与 upper 配套 |
| `atr` | `(high, low, close, n) → series` | 平均真实波幅 | ATR | 高频，波动率 |

不纳入：wma（ema 够用）、adx/cci/stoch/willr/mfi/obv（中低频，可后续补充）。

OHLCV 注册为因子类型，数据来源不关心。

**验收**：函数签名定义完整，validator 白名单注册，测试覆盖，文档更新。

---

### KR4：语言不变量

定义 tickspec 的铁律——编译器强制，违反就是编译错误。

#### 结构不变量（文件级）

| 不变量 | 说明 |
|--------|------|
| 元数据头必填 | `# language: tickspec` + `# kind:` + `# name:` 缺一不可 |
| kind 只能是 `signal` 或 `strategy` | 不允许第三种 |
| name 必须是合法标识符 | `[A-Za-z_][A-Za-z0-9_]*` |

#### 类型不变量（表达式级）

| 不变量 | 说明 |
|--------|------|
| 算术 `+` `-` `*` `/` 两侧必须是 number | `true + 1` 非法 |
| 比较 `<` `<=` `>` `>=` 两侧必须是 number | `true < false` 非法 |
| 等值 `==` `!=` 两侧类型必须相同 | `number == bool` 非法 |
| 逻辑 `and` `or` 两侧必须是 bool | `1 and true` 非法 |
| 一元 `-` 操作数必须是 number | `-true` 非法 |
| 一元 `!` 操作数必须是 bool | `!1` 非法 |
| 未定义引用非法 | 引用的因子/信号/变量必须先声明 |
| 函数参数数量必须正确 | `clamp(1, 2)` 少一个参数非法 |
| 未知函数名非法 | `foo(x)` 如果 foo 不在白名单中非法 |

#### 信号不变量（signal 文件）

| 不变量 | 说明 |
|--------|------|
| inputs 不能为空 | 必须声明至少一个因子 |
| inputs 名称不能重复 | `dup_input` 检测 |
| output 范围必须声明 | `o: [-1, 1]` |
| emit 值必须是 number | signal 文件的 emit 第二个元素是数值，不是 operation |
| emit 条件互斥 | 同一 scheduled_check 的 emit 条件不能同时为 true |
| emit 条件穷举 | 警告：emit 条件可能未覆盖全值域 |
| emit 值在 output 范围内 | 警告：emit 值超出 `[-1, 1]` |
| trigger 名称不能重复 | `dup_trigger` 检测 |
| 同 priority 的 trigger 条件必须互斥 | 两个 trigger 同优先级且条件可能同时为 true → 错误 |
| 不同 priority 的 trigger 允许重叠 | 数字更小者胜出 |
| trigger 输出覆盖 scheduled_checks | trigger 命中时忽略 scheduled |
| 表达式只能引用 inputs 中的因子 | 未定义引用非法 |

#### 策略不变量（strategy 文件）

| 不变量 | 说明 |
|--------|------|
| signals 不能为空 | 必须声明至少一个信号 |
| combine 不能为空 | 必须声明至少一个组合公式 |
| combine 只能在 strategy 文件中出现 | signal 文件不允许有 combine |
| combine 名称必须是合法标识符 | `score` 合法，`1score` 非法 |
| combine 表达式只能引用 signals 中的信号 | 未定义引用非法 |
| combine 结果可在后续 when 中引用 | `score` 可用于 scheduled_checks 和 triggers |
| emit 值必须是 operation | strategy 文件的 emit 第二个元素是 operation，不是数值 |
| operation 同标的不能 target + action 并存 | `QQQ` 同时出现在 target 和 action 中非法 |
| operation 同标的不能 buy + sell 并存 | `QQQ: {buy: 10, sell: 5}` 非法 |
| hold 与 target/action 互斥 | hold 是全局不操作 |
| 未声明的信号不能引用 | 警告：signal 声明了但从未在 combine/when 中引用 |

#### IR 不变量（输出格式）

| 不变量 | 说明 |
|--------|------|
| IR 必须包含 `language: "tickspec"` | 标识语言 |
| IR 必须包含 `version: 1` | 版本号 |
| IR 必须包含 `kind: "signal"` 或 `"strategy"` | 类型标识 |
| signal IR 的 inputs 必须与源文件一致 | 因子声明不丢失 |
| strategy IR 的 signals 必须与源文件一致 | 信号声明不丢失 |
| 表达式必须序列化为 ExprJSON | 不丢失结构信息 |
| operation 必须序列化为 OperationJSON | 不丢失结构信息 |

**验收**：所有不变量在 validator 中有对应检查，测试覆盖每条不变量的正反案例，文档更新。

---

### 总体验收

四个 KR 完成后，tickspec 应能表达：

```yaml
inputs:
  - close     #number
  - high      #number
  - low       #number
  - volume    #number

triggers:
  - name: oversold_bounce
    when: rsi(close, 14) < 30 and close > ema(close, 50)
    emit:
      - [true, 0.8]
    priority: 0
```

且所有不变量在编译时强制。

### 函数总清单

| KR | 函数 | 数量 |
|----|------|------|
| 已有 | cross_over, clamp | 2 |
| KR1 | abs, sign, sqrt, log, exp, min, max | 7 |
| KR2 | lag, change, pct_change, rolling_mean, rolling_std, rolling_min, rolling_max | 7 |
| KR3 | ema, rsi, macd, bollinger_upper, bollinger_lower, atr | 6 |
| **合计** | | **22** |
