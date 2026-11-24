"""诊断代理的单元测试：不联网、不花钱，只验证提示词与输出收敛逻辑。

运行：python -m unittest discover -s test -p "test_*.py"
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import llm_proxy  # noqa: E402


class ParseTest(unittest.TestCase):
    def test_plain_json(self):
        raw = '{"errorType":"boundary","question":"q","hint":"h"}'
        self.assertEqual(llm_proxy.parse_model_output(raw)["errorType"], "boundary")

    def test_fenced_json(self):
        raw = '```json\n{"errorType":"recursion","question":"q"}\n```'
        self.assertEqual(llm_proxy.parse_model_output(raw)["errorType"], "recursion")

    def test_chatty_model(self):
        raw = '好的，分析如下：\n{"errorType":"logic","question":"q"}\n希望有帮助。'
        self.assertEqual(llm_proxy.parse_model_output(raw)["errorType"], "logic")

    def test_garbage(self):
        self.assertIsNone(llm_proxy.parse_model_output("我不知道"))


class SanitizeTest(unittest.TestCase):
    def test_unknown_type_falls_back(self):
        result = llm_proxy.sanitize({"errorType": "乱写", "question": "q"})
        self.assertEqual(result["errorType"], "logic")

    def test_confidence_clamped(self):
        self.assertEqual(llm_proxy.sanitize({"question": "q", "confidence": 9})["confidence"], 1.0)
        self.assertEqual(llm_proxy.sanitize({"question": "q", "confidence": -3})["confidence"], 0.0)

    def test_negative_line_dropped(self):
        self.assertIsNone(llm_proxy.sanitize({"question": "q", "line": -2})["line"])

    def test_code_leak_blocked(self):
        result = llm_proxy.sanitize(
            {
                "question": "q",
                "hint": "for (int i = 0; i < n; i++) { swap(a[i], a[i + 1]); }",
            }
        )
        self.assertTrue(result["codeLeakRemoved"])
        self.assertNotIn("swap(", result["hint"])

    def test_clean_hint_kept(self):
        result = llm_proxy.sanitize({"question": "q", "hint": "先手算 n=3 的情况。"})
        self.assertFalse(result["codeLeakRemoved"])
        self.assertEqual(result["hint"], "先手算 n=3 的情况。")

    def test_always_forbids_solution(self):
        self.assertTrue(llm_proxy.sanitize({"question": "q"})["forbidCompleteSolution"])

    def test_empty_question_gets_default(self):
        self.assertTrue(llm_proxy.sanitize({"errorType": "logic"})["question"])


class HandleTest(unittest.TestCase):
    def test_empty_code_rejected(self):
        status, body = llm_proxy.handle({"code": "  "})
        self.assertEqual(status, 400)
        self.assertEqual(body["reason"], "empty_code")

    def test_mock_mode_returns_result(self):
        os.environ["LLM_MOCK"] = "1"
        try:
            status, body = llm_proxy.handle({"code": "int main(){return 0;}"})
        finally:
            os.environ.pop("LLM_MOCK", None)
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["meta"]["model"], "mock")


if __name__ == "__main__":
    unittest.main()