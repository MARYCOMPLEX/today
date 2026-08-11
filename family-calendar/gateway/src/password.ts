const COMMON = new Set(["123456789012", "password1234", "qwertyuiop12", "111111111111", "abcdefghijkl", "wechat123456", "iloveyou1234"]);

export function passwordProblem(password: string, email: string, phone?: string | null): string | null {
  if (password.length < 12 || password.length > 128) return "密码必须为 12–128 个字符";
  const lower = password.toLowerCase();
  const local = email.split("@", 1)[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && lower.includes(local)) return "密码不能包含邮箱用户名";
  if (phone && password.includes(phone)) return "密码不能包含手机号";
  if (/^\d+$/.test(password)) return "密码不能全是数字";
  if (/^(.)\1{11,}$/.test(password)) return "密码不能是重复字符";
  if (COMMON.has(lower)) return "密码过于常见";
  return null;
}

export function validChinaPhone(phone: string): boolean { return /^1[3-9]\d{9}$/.test(phone); }
