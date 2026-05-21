import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";

const triggerBaseClasses =
  "cursor-pointer rounded border border-dashed px-4 text-center text-sm transition-colors duration-150 select-none";

const defaultInactiveClasses =
  "border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-300";

const defaultActiveClasses =
  "border-cyan-400 bg-cyan-950/35 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.25)]";

export interface DashedFileDropZoneProps {
  selectedFile: File | null;
  /** Second argument is the hidden file input (for clearing `value` on validation errors). */
  onFileChange: (
    file: File | null,
    input: HTMLInputElement | null,
  ) => void;
  emptyText?: string;
  trigger?: "label" | "button";
  accept?: string;
  inputKey?: React.Key;
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  triggerClassName?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  className?: string; // If provided, completely overrides the default layout/base classes
  id?: string;
  children?: ReactNode | ((props: { isDropActive: boolean; file: File | null }) => ReactNode);
}

export function DashedFileDropZone({
  selectedFile,
  onFileChange,
  emptyText,
  trigger = "label",
  accept,
  inputKey,
  fileInputRef: fileInputRefProp,
  triggerClassName = "",
  activeClassName = defaultActiveClasses,
  inactiveClassName = defaultInactiveClasses,
  className,
  id: idProp,
  children,
}: DashedFileDropZoneProps) {
  const generatedId = useId();
  const inputId = idProp ?? generatedId;
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const dropEnterCountRef = useRef(0);
  const [isDropActive, setIsDropActive] = useState(false);

  const assignInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      internalInputRef.current = node;
      if (fileInputRefProp) {
        fileInputRefProp.current = node;
      }
    },
    [fileInputRefProp],
  );

  const getInput = useCallback((): HTMLInputElement | null => {
    return internalInputRef.current;
  }, []);

  function hasFilePayload(e: DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes("Files");
  }

  function resetDropVisualState(): void {
    dropEnterCountRef.current = 0;
    setIsDropActive(false);
  }

  function handleDragEnter(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFilePayload(e)) return;
    dropEnterCountRef.current += 1;
    setIsDropActive(true);
  }

  function handleDragLeave(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (!hasFilePayload(e)) return;
    dropEnterCountRef.current -= 1;
    if (dropEnterCountRef.current <= 0) {
      resetDropVisualState();
    }
  }

  function handleDragOver(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    e.stopPropagation();
    if (hasFilePayload(e)) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(e: DragEvent<HTMLElement>): void {
    e.preventDefault();
    e.stopPropagation();
    resetDropVisualState();
    const file = e.dataTransfer.files?.[0] ?? null;
    onFileChange(file, getInput());
    const input = getInput();
    if (input) input.value = "";
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>): void {
    const input = e.target;
    onFileChange(input.files?.[0] ?? null, input);
  }

  const layoutClasses =
    trigger === "button" ? "block w-full py-4" : "block py-6";

  const triggerClass = className !== undefined 
    ? [className, isDropActive ? activeClassName : inactiveClassName].filter(Boolean).join(" ")
    : [
        layoutClasses,
        triggerBaseClasses,
        triggerClassName,
        isDropActive ? activeClassName : inactiveClassName,
      ]
        .filter(Boolean)
        .join(" ");

  const content = children 
    ? (typeof children === "function" ? children({ isDropActive, file: selectedFile }) : children)
    : (selectedFile ? selectedFile.name : emptyText);

  const input = (
    <input
      ref={assignInputRef}
      key={inputKey}
      id={inputId}
      type="file"
      accept={accept}
      className="sr-only"
      onChange={handleInputChange}
    />
  );

  if (trigger === "button") {
    return (
      <>
        <button
          type="button"
          className={triggerClass}
          onClick={() => getInput()?.click()}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {content}
        </button>
        {input}
      </>
    );
  }

  return (
    <>
      <label
        htmlFor={inputId}
        className={triggerClass}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {content}
      </label>
      {input}
    </>
  );
}
