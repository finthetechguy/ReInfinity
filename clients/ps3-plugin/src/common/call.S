/* u64 lv2_call(u32 opd, u64 a0, u64 a1, u64 a2, u64 a3)
   Calls a function outside our module through its LV2 descriptor {u32 entry, u32 toc}, the way
   our import stubs (build/<module>_imports.S) do: it saves our TOC, loads the callee's, and
   restores ours after. */
	.section ".text"
	.align 2

	.section ".opd","aw"
	.align 3
	.globl lv2_call
lv2_call:
	.quad .L.lv2_call,.TOC.@tocbase,0
	.previous
	.type lv2_call, @function
.L.lv2_call:
	mflr 0
	std 0,16(1)
	stdu 1,-128(1)
	std 2,40(1)
	clrldi 12,3,32
	lwz 0,0(12)
	lwz 2,4(12)
	mtctr 0
	mr 3,4
	mr 4,5
	mr 5,6
	mr 6,7
	bctrl
	ld 2,40(1)
	addi 1,1,128
	ld 0,16(1)
	mtlr 0
	blr
	.size lv2_call,.-.L.lv2_call
