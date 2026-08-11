# 添加事件模板（复制后填）

> 历法只选一个：**农历** 或 **阳历**（二选一，填在 `calendar` 字段）
> 填好后发一个 Issue，标题 `[event] 事件名`，正文贴下面的 JSON，然后打上 `event` 标签

```json
{
  "id": "唯一英文id-如-gao-guo-birthday",
  "name": "事件显示名，如：哥哥生日",
  "person": "谁，如：哥哥",
  "calendar": "lunar",
  "month": 8,
  "day": 15,
  "leap_policy": "leap_first",
  "birth_year": 1990,
  "message": "🎂 $name（$person）农历生日，今年 $age 岁"
}
```

## calendar 字段说明（只填一个）

| 值 | 含义 | 示例 |
|---|---|---|
| `lunar` | 农历生日/节日（每年公历日期不同） | 八月十五 → 每年中秋节前后 |
| `solar` | 阳历日期（固定公历） | 10月1日 国庆 |

- 生日用农历就填 `lunar`，用阳历就填 `solar`，**不要两个都填**
- 闰月策略 `leap_policy`：`leap_first` 有闰月过闰月、没有过正月；`normal` 永远过正月
- 阳历 2/29 生日平年默认按 2/28 过（`leap_day_policy`）
- **播报窗口固定**：每天三个时段自动播报当天 + 未来 5 天内的事件，无需在条目里配置提醒天数
