; From tree-sitter-swift (https://github.com/alex-pinkus/tree-sitter-swift), queries/tags.scm
; at 33e56e4e2a6455f3fd4e04cfe5c7a314d498612d.
; Copyright (c) 2021 alex-pinkus. MIT.
; Changed for Lo: a type's members are tagged with their own declarations, where the grammar's
; query tagged each with its whole type, and an enum's members as well as a class's or struct's;
; and properties only in a type's body and at the top of a file, where it tagged every constant
; and variable, the local ones in function bodies too.

(class_declaration
  name: (type_identifier) @name) @definition.class

(protocol_declaration
  name: (type_identifier) @name) @definition.interface

(class_declaration
    (class_body
        [
            (function_declaration
                name: (simple_identifier) @name
            ) @definition.method
            (subscript_declaration
                (parameter (simple_identifier) @name)
            ) @definition.method
            (init_declaration "init" @name) @definition.method
            (deinit_declaration "deinit" @name) @definition.method
        ]
    )
)

(class_declaration
    (enum_class_body
        [
            (function_declaration
                name: (simple_identifier) @name
            ) @definition.method
            (subscript_declaration
                (parameter (simple_identifier) @name)
            ) @definition.method
            (init_declaration "init" @name) @definition.method
            (deinit_declaration "deinit" @name) @definition.method
        ]
    )
)

(protocol_declaration
    (protocol_body
        [
            (protocol_function_declaration
                name: (simple_identifier) @name
            ) @definition.method
            (subscript_declaration
                (parameter (simple_identifier) @name)
            ) @definition.method
            (init_declaration "init" @name) @definition.method
        ]
    )
)

(class_declaration
    (class_body
        [
            (property_declaration
                (pattern (simple_identifier) @name)
            ) @definition.property
        ]
    )
)

(class_declaration
    (enum_class_body
        [
            (property_declaration
                (pattern (simple_identifier) @name)
            ) @definition.property
        ]
    )
)

(source_file
    (property_declaration
        (pattern (simple_identifier) @name)
    ) @definition.property
)

(function_declaration
    name: (simple_identifier) @name) @definition.function
