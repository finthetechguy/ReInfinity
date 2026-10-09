/* Links the module as two segments: code at 0 and everything else from DATA_BASE.
   The PS3 loads PRX segments at unrelated addresses, so constants stay with the data,
   where code reaches them TOC-relative. mkprx.py turns this into a PRX. */
OUTPUT_FORMAT("elf64-powerpc", "elf64-powerpc", "elf64-powerpc")
OUTPUT_ARCH(powerpc:common64)
ENTRY(module_start)

PHDRS
{
  text PT_LOAD FLAGS(5);
  data PT_LOAD FLAGS(6);
}

DATA_BASE = 0x10000000;

SECTIONS
{
  . = 0;
  .text : { __prx_text_start = .; *(.text .text.* .stub) __prx_text_end = .; } :text

  . = DATA_BASE;
  __prx_data_start = .;
  .rodata : ALIGN(16) { *(.rodata .rodata.* .rodata1 .sdata2 .sdata2.*) } :data
  .data.rel.ro : ALIGN(8) { *(.data.rel.ro .data.rel.ro.*) } :data
  .opd : ALIGN(8) { KEEP(*(.opd)) } :data
  .got : ALIGN(8) { *(.got .toc) } :data
  .data : ALIGN(8) { *(.data .data.* .sdata .sdata.*) } :data
  .bss : ALIGN(8) { *(.sbss .sbss.* .tocbss .bss .bss.* COMMON) } :data
  __prx_data_end = .;

  /DISCARD/ : { *(.comment) *(.note .note.*) *(.eh_frame .eh_frame_hdr) *(.gnu.attributes) *(.interp) *(.dynamic) }
}
