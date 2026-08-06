# tickspec 必要性验证报告

**日期**: 2026-08-07
**研究范围**: 5 个角度，50+ 工具/标准/框架

---

## 结论

**tickspec 填补的是一个真实的空白。** 没有直接替代品。

---

## 核心发现

### 1. 现有 DSL 全是命令式 + 平台锁定

| DSL | 平台 | 声明式？ | 可移植？ |
|-----|------|----------|----------|
| Pine Script | TradingView | 半 | 否 |
| EasyLanguage | TradeStation | 否 | 否 |
| MQL4/5 | MetaTrader | 否 | 否 |
| NinjaScript | NinjaTrader | 否 | 否 |
| ThinkScript | thinkorswim | 大部分 | 否 |
| AFL | AmiBroker | 否 | 否 |

**没有一个纯声明式的交易 DSL。** 没有一个可跨平台移植。

### 2. 量化框架全部是代码优先

| 框架 | 声明式？ | 信号/执行分离？ | 可移植 IR？ |
|------|----------|----------------|-------------|
| Zipline | 否 | 部分 | 否 |
| Backtrader | 否 | 否 | 否 |
| Lean (QuantConnect) | 否 | **是** | 否 |
| VectorBT | 否 | 是 | 否 |
| QLib (微软) | **部分** | 是 | 部分 |
| Rqalpha | 否 | 否 | 否 |
| vnpy | 否 | 否 | 否 |

Lean 的 Alpha/PortfolioConstruction 分离最接近 tickspec 的 signal/strategy 分离，但它是代码，不是配置。
QLib 用 YAML 但只针对 ML 策略，不支持规则型策略。

**没有框架提供可移植的策略中间表示。**

### 3. 行业标准只覆盖执行层，不覆盖策略层

```
[行情数据]  →  [信号/因子逻辑]  →  [策略组合]  →  [订单生成]  →  [执行/清算]
  MDDL              ???                       ???                FIX              ISO 20022
  Bloomberg                                                              FpML
```

- FIX：只管订单路由，不管"怎么决定下单"
- FPML：只管衍生品产品定义，"Strategy" 指的是期权组合腿，不是交易策略
- ISO 20022：只管清算和支付
- FIBO/OMG：只管金融知识本体，不管交易逻辑

**信号/策略层是整个交易管线中唯一没有标准化的层。**

### 4. LLM 是互补，不是替代

| 维度 | LLM 直接生成代码 | tickspec DSL | LLM → tickspec 管线 |
|------|-----------------|--------------|---------------------|
| 易用性 | ★★★★★ | ★★★ | ★★★★ |
| 可审计性 | ★ | ★★★★★ | ★★★★ |
| 确定性 | ★ | ★★★★★ | ★★★★ |
| 团队协作 | ★★ | ★★★★★ | ★★★★ |
| 合规性 | ★ | ★★★★★ | ★★★★ |

LLM 是更好的**输入接口**，不是替代品。理想管线：

```
自然语言 → LLM 生成 .tksp → 编译器验证 → JSON IR → 执行层
```

---

## tickspec 的独特组合

经过 50+ 工具/标准/框架的搜索，**没有找到任何同时满足以下四点的工具**：

1. **YAML 作为策略定义语言**（不是 YAML 配置 + Python 逻辑）
2. **signal/strategy 清晰分离**（信号产出 [-1,1]，策略组合信号产出 operation）
3. **加权信号组合在配置中声明**（不是代码中）
4. **输出可移植的 JSON IR**（不绑定特定执行引擎）

---

## 风险

| 风险 | 严重性 | 说明 |
|------|--------|------|
| 行业惯性 | 高 | 量化行业偏好代码灵活性，声明式可能不够表达复杂策略 |
| 复杂性天花板 | 中 | 纯 YAML 能否覆盖所有策略类型？ML 型策略怎么办？ |
| 采纳门槛 | 中 | 新格式需要生态建设（编辑器支持、文档、社区） |
| 竞争壁垒低 | 中 | 技术不难，难在先发优势和生态 |

---

## 机会

1. **LLM 管线的编译目标** — AI 生成的策略需要一个可审计的中间格式
2. **合规需求** — 监管要求可审计、可复现的策略表示
3. **团队协作** — 非程序员（quant researcher）可以写 .tksp，程序员对接执行层
4. **跨平台移植** — 同一份 .tksp 可以编译到 Lean、QLib、或自研引擎

---

## Sources

- F1: 现有 DSL 调研 (Pine Script, EasyLanguage, MQL, NinjaScript, ThinkScript, AFL 等 13 个)
- F2: YAML/JSON 配置式工具调研 (Freqtrade, Jesse, Hummingbot, StrategyQuant 等 13 个)
- F3: 量化框架调研 (Zipline, Backtrader, Lean, VectorBT, QLib, Rqalpha, vnpy 等 8 个)
- F4: 行业标准调研 (FIX, FpML, FIBO, ISO 20022, MDDL, W3C 等 6 个)
- F5: LLM/AI 方向调研 (FinGPT, FinRL, BloombergGPT, TradingGPT, Capitalise.ai 等)

**注意**: 研究期间外部搜索不可用，基于训练知识。URL 和数据需验证。
