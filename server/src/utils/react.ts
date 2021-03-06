import {
    AssignmentExpression,
    AssignmentPattern,
    AstNode,
    CallExpression,
    FunctionExpression,
    Identifier,
    MemberExpression,
    NodePath,
    ObjectMethod,
    ObjectProperty,
    OptionalCallExpression,
    TSQualifiedName,
    TSType,
    TSTypeAnnotation,
    TSTypeReference,
    TypeName,
    VariableDeclarator,
} from 'ast-types';
import { JsCodeShift } from 'jscodeshift';

/**
 * Catch all identifiers that begin with "use" followed by an uppercase Latin
 * character to exclude identifiers like "user".
 */

function isHookName(s: string) {
    return /^use[A-Z0-9].*$/.test(s);
}

/**
 * We consider hooks to be a hook name identifier or a member expression
 * containing a hook name.
 */

function isHook(node: AstNode) {
    if (node.type === 'Identifier') {
        return isHookName((node as Identifier).name);
    } else if (
        node.type === 'MemberExpression' &&
        !(node as MemberExpression).computed &&
        isHook((node as MemberExpression).property)
    ) {
        const obj = (node as MemberExpression).object;
        const isPascalCaseNameSpace = /^[A-Z].*/;
        return obj.type === 'Identifier' && isPascalCaseNameSpace.test((obj as Identifier).name);
    } else {
        return false;
    }
}

/**
 * Checks if the node is a React component name. React component names must
 * always start with a non-lowercase letter. So `MyComponent` or `_MyComponent`
 * are valid component names for instance.
 */

export function isReactComponentName(node: AstNode): node is Identifier {
    if (node.type === 'Identifier') {
        return !/^[a-z]/.test((node as Identifier).name);
    } else {
        return false;
    }
}

function isReactFunction(node: AstNode, functionName: string) {
    return (
        (node.type === 'Identifier' && (node as Identifier).name === functionName) ||
        (node.type === 'MemberExpression' &&
            (node as MemberExpression).object.type === 'Identifier' &&
            ((node as MemberExpression).object as Identifier).name === 'React' &&
            (node as MemberExpression).property.type === 'Identifier' &&
            ((node as MemberExpression).property as Identifier).name === functionName)
    );
}

/**
 * Checks if the node is a callback argument of forwardRef. This render function
 * should follow the rules of hooks.
 */

function isForwardRefCallback(path: NodePath<AstNode>) {
    const isCallExpr =
        path.parent &&
        (path.parent.node.type === 'CallExpression' ||
            path.parent.node.type === 'OptionalCallExpression');
    if (!isCallExpr) {
        return false;
    }
    const node = path.parent.node as CallExpression | OptionalCallExpression;
    return !!(node.callee && isReactFunction(node.callee, 'forwardRef'));
}

/**
 * Checks if the node is a callback argument of React.memo. This anonymous
 * functional component should follow the rules of hooks.
 */

function isMemoCallback(path: NodePath<AstNode>) {
    const isCallExpr =
        path.parent &&
        (path.parent.node.type === 'CallExpression' ||
            path.parent.node.type === 'OptionalCallExpression');
    if (!isCallExpr) {
        return false;
    }
    const node = path.parent.node as CallExpression | OptionalCallExpression;
    return !!(node.callee && isReactFunction(node.callee, 'memo'));
}

/**
 * Gets the static name of a function AST node. For function declarations it is
 * easy. For anonymous function expressions it is much harder. If you search for
 * `IsAnonymousFunctionDefinition()` in the ECMAScript spec you'll find places
 * where JS gives anonymous function expressions names. We roughly detect the
 * same AST nodes with some exceptions to better fit our usecase.
 */

function getFunctionName(path: NodePath<AstNode>) {
    if (
        path.node.type === 'FunctionDeclaration' ||
        (path.node.type === 'FunctionExpression' && (path.node as FunctionExpression).id)
    ) {
        // function useHook() {}
        // const whatever = function useHook() {};
        //
        // Function declaration or function expression names win over any
        // assignment statements or other renames.
        return (path.node as FunctionExpression).id;
    } else if (
        path.node.type === 'FunctionExpression' ||
        path.node.type === 'ArrowFunctionExpression'
    ) {
        if (
            path.parent.node.type === 'VariableDeclarator' &&
            (path.parent.node as VariableDeclarator).init === path.node
        ) {
            // const useHook = () => {};
            return (path.parent.node as VariableDeclarator).id;
        } else if (
            path.parent.node.type === 'AssignmentExpression' &&
            (path.parent.node as AssignmentExpression).right === path.node &&
            (path.parent.node as AssignmentExpression).operator === '='
        ) {
            // useHook = () => {};
            return (path.parent.node as AssignmentExpression).left;
        } else if (
            path.parent.node.type === 'ObjectProperty' &&
            (path.parent.node as ObjectProperty).value === path.node &&
            !(path.parent.node as ObjectProperty).computed
        ) {
            // {useHook: () => {}}
            return (path.parent.node as ObjectProperty).key;

            // NOTE: We could also support `ClassProperty` and `MethodDefinition`
            // here to be pedantic. However, hooks in a class are an anti-pattern. So
            // we don't allow it to error early.
            //
            // class {useHook = () => {}}
            // class {useHook() {}}
        } else if (
            path.parent.node.type === 'AssignmentPattern' &&
            (path.parent.node as AssignmentPattern).right === path.node
        ) {
            // const {useHook = () => {}} = {};
            // ({useHook = () => {}} = {});
            //
            // Kinda clowny, but we'd said we'd follow spec convention for
            // `IsAnonymousFunctionDefinition()` usage.
            return (path.parent.node as AssignmentPattern).left;
        } else {
            return undefined;
        }
    } else if (path.node.type === 'ObjectMethod' && !(path.node as ObjectMethod).computed) {
        // {useHook() {}}
        return (path.node as ObjectMethod).key;
    } else {
        return undefined;
    }
}

export function isReactFunctionComponentOrHook(path: NodePath<AstNode>) {
    const functionName = getFunctionName(path);
    if (functionName) {
        if (isReactComponentName(functionName) || isHook(functionName)) {
            return true;
        }
    }
    if (isForwardRefCallback(path) || isMemoCallback(path)) {
        return true;
    }
    return false;
}

const invalidHookParents: TypeName[] = [
    'WhileStatement',
    'DoWhileStatement',
    'ForAwaitStatement',
    'ForInStatement',
    'ForOfStatement',
    'ForStatement',
    'IfStatement',
    'SwitchStatement',
];
export function isInvalidHookParent(path: NodePath<AstNode>) {
    return invalidHookParents.includes(path.node.type as any);
}

/**
 * We node is inside a hook or function component AND not inside a loop or condition statement.
 *
 * Note: Preliminary returns up the code path or conditional expressions are NOT checked.
 */
export function isValidHookLocation(path: NodePath<AstNode>) {
    let insideReactFunctionComponentOrHook = false;
    let currentPath = path.parent;
    while (currentPath) {
        if (isReactFunctionComponentOrHook(currentPath)) {
            insideReactFunctionComponentOrHook = true;
            break;
        }
        if (isInvalidHookParent(currentPath)) {
            return false;
        }
        currentPath = currentPath.parent;
    }
    return insideReactFunctionComponentOrHook;
}

export function isReactFunctionComponent(path: NodePath<AstNode>) {
    const functionName = getFunctionName(path);
    if (functionName) {
        if (isReactComponentName(functionName) || isHook(functionName)) {
            return true;
        }
    }
    if (isForwardRefCallback(path) || isMemoCallback(path)) {
        return true;
    }
    return false;
}

export function isInsideReactFunctionComponentOrHook(path: NodePath<AstNode>) {
    while (path) {
        if (isReactFunctionComponentOrHook(path)) {
            return true;
        }
        path = path.parent;
    }
    return false;
}

const FUNCTION_COMPONENT_TYPE_NAME = [
    'FunctionComponent',
    'FC',
    /* deprecated */ 'StatelessComponent',
    /* deprecated */ 'SFC',
];

/**
 * Takes the identifier: `const Identifier: React.FunctionComponent<Props> = () => {}`;
 *
 * Check two cases: `const Foo: React.FunctionComponent<Props>` and `const Foo: FunctionComponent<Props>`.
 *
 * Returns `Props` type.
 */
export function getPropsTypeFromVariableDeclaratorId(
    j: JsCodeShift,
    variableDeclaratorId: Identifier
) {
    if (!variableDeclaratorId.typeAnnotation) {
        return null;
    }
    let propsType: TSType | null = null;
    const isIdentifierAnnotation = j.match<TSTypeAnnotation>(variableDeclaratorId.typeAnnotation, {
        type: j.TSTypeAnnotation.name,
        typeAnnotation: {
            type: j.TSTypeReference.name,
            typeName: {
                type: j.Identifier.name,
            } as Identifier,
            typeParameters: {
                type: j.TSTypeParameterInstantiation.name,
                params: {
                    length: 1,
                },
            },
        } as TSTypeReference,
    });
    const isQualifiedNameAnnotation = j.match<TSTypeAnnotation>(
        variableDeclaratorId.typeAnnotation,
        {
            type: j.TSTypeAnnotation.name,
            typeAnnotation: {
                type: j.TSTypeReference.name,
                typeName: {
                    type: j.TSQualifiedName.name,
                    left: {
                        type: j.Identifier.name,
                        name: 'React',
                    },
                    right: {
                        type: j.Identifier.name,
                    },
                } as TSQualifiedName,
                typeParameters: {
                    type: j.TSTypeParameterInstantiation.name,
                    params: {
                        length: 1,
                    },
                },
            } as TSTypeReference,
        }
    );
    if (isIdentifierAnnotation || isQualifiedNameAnnotation) {
        // Validate that the name is one of FUNCTION_COMPONENT_TYPE_NAME, if yes, assign the type
        const typeRef = variableDeclaratorId.typeAnnotation!.typeAnnotation as TSTypeReference;
        let name;
        if (typeRef.typeName.type === j.Identifier.name) {
            name = (typeRef.typeName as Identifier).name;
        } else {
            name = ((typeRef.typeName as TSQualifiedName).right as Identifier).name;
        }
        if (FUNCTION_COMPONENT_TYPE_NAME.includes(name)) {
            propsType = typeRef.typeParameters!.params[0];
        }
    }
    return propsType;
}
