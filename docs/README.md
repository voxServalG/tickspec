# tickspec

> 一门基于 **YAML** 格式的量化交易信号/策略描述语言。

## 概述

tickspec 是一份语言规约与 TypeScript 语言处理器，用 `.tksp` 文件描述交易信号与策略。语言完全遵循 YAML 语法，元数据以 `# key: value` 注释形式书写。

两种文件类型：

| 文件 kind | 职责 |
|-----------|------|
| `signal`  | 消费外部因子，产出 `[-1, 1]` 标量信号值 |
| `strategy` | 组合多个信号，加权得 score，产出最终 **操作（operation）** |

---

## 文档导航

文档入口见 [index.md](./index.md)。

## 语法规范

### 元数据头（每文件必填）

```yaml
# language: tickspec
# kind: signal       # signal | strategy
# name: my_signal
```

### 因子系统

因子由外部因子库计算，`.tksp` 只声明消费哪些因子。四种类型：

| 类型 | 说明 | 可比较 |
|------|------|--------|
| `number` | 浮点数 | 大小比较 |
| `bool` | 布尔值 | 逻辑运算 |
| `enum` | 无序列举 | 仅 `==` / `!=` |
| `ordinal` | 有序分类 | 大小比较 |

类型以行内注释标注：`- factor_name #number`

---

## 信号文件（kind: signal）

### inputs — 因子声明

```yaml
inputs:
  - drawdown_3mo  #number
  - return_1d     #number
```

### output — 输出范围

```yaml
output:
  o: [-1, 1]   # 最终输出会 clamp 到此区间
```

### scheduled_checks — 定时检查

```yaml
scheduled_checks:
  - name: daily_check
    every: 1d              # 执行频率：1d, 1h, 1w ...
    emit:
      - [条件, 信号值]
```

- `every` 指定执行周期
- `emit` 为 `[bool条件, number输出值]` 列表
- 同一 `name` 内条件必须**互斥**，每次恰好命中一条

### triggers — 事件触发

```yaml
triggers:
  - name: fast_drop
    when: 条件表达式           # bool
    emit:
      - [true, 信号值]
    priority: 0               # 必填，越小越优先
```

两种条件类型：

| 类型 | 示例 | 行为 |
|------|------|------|
| 电平 (Level) | `price <= -0.03` | 条件为 true 期间持续输出 |
| 脉冲 (Edge) | `cross_over(value, 0.05)` | 只在穿越阈值瞬间单次输出 |

priority 规则：
- 最小值为 0，越小越优先
- 仅命中 priority 最小的 trigger
- 同 priority 的 active trigger 条件必须互斥
- trigger 输出**覆盖** scheduled_checks 输出

---

## 策略文件（kind: strategy）

### signals — 依赖信号

```yaml
signals:
  - signal_a
  - signal_b
```

### combine — 加权组合

```yaml
combine:
  - score: clamp(0.7*signal_a + 0.3*signal_b, -1, 1)
```

`clamp(表达式, 下界, 上界)` — 限制结果区间。`score` 供后续逻辑引用。

### operation — 操作三形态

策略的 emit 产出 operation 而非数值。三种形态：

| 形态 | 格式 | 示例 |
|------|------|------|
| target | `{target: {标的: 仓位比例}}` | `{target: {QQQ: 0.15}}` |
| action | `{action: {标的: {方向: 数量}}}` | `{action: {QQQ: {buy: 20}}}` |
| hold | `hold` | `hold` |

方向仅支持 `buy` / `sell`，单位语义由执行层定义。

**共存规则：**

| 规则 | 说明 |
|------|------|
| target + action 可共存 | 必须用于**不同标的** |
| hold 与 target/action 互斥 | hold 表示全局不动 |
| 同标的不许冲突 | 同标的不允 target+action 并存，不允 buy+sell 并存 |
| 隐式 hold | 未出现的标的默认不做调整 |

```yaml
# 合法：target 与 action 共存，不同标的
{target: {QQQ: 0.10}, action: {SPY: {buy: 20}}}

# 非法：同标的冲突
{target: {QQQ: 0.15}, action: {QQQ: {buy: 20}}}
{action: {QQQ: {buy: 10, sell: 5}}}
```

### 策略级 scheduled_checks / triggers

结构与信号文件一致，但 emit 产出为 `[条件, operation]`。trigger priority 规则同上。

---

## 互斥约束总览

| 层级 | 约束 |
|------|------|
| emit 内条件 | 同一 name 的 emit 条件必须互斥 |
| operation 内 | target/action 可共存（不同标的），hold 与二者互斥 |
| 同标的 | 不允 target+action 并存，不允 buy+sell 并存 |
| trigger 同 priority | active trigger 条件必须互斥 |
| trigger 不同 priority | 允许重叠，数字更小者胜出 |
| trigger vs scheduled | trigger 覆盖 scheduled 输出 |

---

## 项目状态

当前已提供 TypeScript parser、validator、Canonical JSON IR emitter 与 CLI。示例文件位于 `src/qqq_signal.tksp` 与 `src/qqq_strategy.tksp`。
