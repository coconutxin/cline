import { describe, it } from "mocha"
import "should"
import { findLast, findLastIndex, parseUserSelectableOptions } from "./array"

describe("Array Utilities", () => {
	describe("findLastIndex", () => {
		it("should find last matching element's index", () => {
			const array = [1, 2, 3, 2, 1]
			const index = findLastIndex(array, (x) => x === 2)
			index.should.equal(3) // last '2' is at index 3
		})

		it("should return -1 when no element matches", () => {
			const array = [1, 2, 3]
			const index = findLastIndex(array, (x) => x === 4)
			index.should.equal(-1)
		})

		it("should handle empty arrays", () => {
			const array: number[] = []
			const index = findLastIndex(array, (x) => x === 1)
			index.should.equal(-1)
		})

		it("should work with different types", () => {
			const array = ["a", "b", "c", "b", "a"]
			const index = findLastIndex(array, (x) => x === "b")
			index.should.equal(3)
		})

		it("should provide correct index in predicate", () => {
			const array = [1, 2, 3]
			const indices: number[] = []
			findLastIndex(array, (_, index) => {
				indices.push(index)
				return false
			})
			indices.should.deepEqual([2, 1, 0]) // Should iterate in reverse
		})

		it("should provide array reference in predicate", () => {
			const array = [1, 2, 3]
			findLastIndex(array, (_, __, arr) => {
				arr.should.equal(array) // Should pass original array
				return false
			})
		})
	})

	describe("findLast", () => {
		it("should find last matching element", () => {
			const array = [1, 2, 3, 2, 1]
			const element = findLast(array, (x) => x === 2)
			should(element).not.be.undefined()
			element!.should.equal(2)
		})

		it("should return undefined when no element matches", () => {
			const array = [1, 2, 3]
			const element = findLast(array, (x) => x === 4)
			should(element).be.undefined()
		})

		it("should handle empty arrays", () => {
			const array: number[] = []
			const element = findLast(array, (x) => x === 1)
			should(element).be.undefined()
		})

		it("should work with object arrays", () => {
			const array = [
				{ id: 1, value: "a" },
				{ id: 2, value: "b" },
				{ id: 3, value: "a" },
			]
			const element = findLast(array, (x) => x.value === "a")
			should(element).not.be.undefined()
			element!.should.deepEqual({ id: 3, value: "a" })
		})

		it("should provide correct index in predicate", () => {
			const array = [1, 2, 3]
			const indices: number[] = []
			findLast(array, (_, index) => {
				indices.push(index)
				return false
			})
			indices.should.deepEqual([2, 1, 0]) // Should iterate in reverse
		})
	})

	describe("parseUserSelectableOptions", () => {
		it("should preserve native string array options", () => {
			parseUserSelectableOptions([" Option A ", "Option B", ""]).should.deepEqual(["Option A", "Option B"])
		})

		it("should parse JSON array string options", () => {
			parseUserSelectableOptions('["Option A", "Option B", "Option C"]').should.deepEqual([
				"Option A",
				"Option B",
				"Option C",
			])
		})

		it("should parse partial JSON array string options", () => {
			parseUserSelectableOptions('["Option A", "Option B"').should.deepEqual(["Option A", "Option B"])
		})

		it("should parse numbered list string options", () => {
			parseUserSelectableOptions(
				"1. 开始实现一转法师 v3 的某个具体技能\n2. 先检查/准备一转法师 v3 三表与号段\n3. 继续完善或调整一转法师 v3 计划文档\n4. 其它任务（请直接说明）",
			).should.deepEqual([
				"开始实现一转法师 v3 的某个具体技能",
				"先检查/准备一转法师 v3 三表与号段",
				"继续完善或调整一转法师 v3 计划文档",
				"其它任务（请直接说明）",
			])
		})

		it("should parse bulleted list string options", () => {
			parseUserSelectableOptions("- Option A\n- Option B\n- Option C").should.deepEqual([
				"Option A",
				"Option B",
				"Option C",
			])
		})

		it("should not parse unmarked plain text as options", () => {
			parseUserSelectableOptions("Option A\nOption B").should.deepEqual([])
		})
	})
})
