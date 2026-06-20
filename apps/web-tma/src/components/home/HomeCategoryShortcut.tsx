interface Props {
  image: string
  onClick: () => void
}

export default function HomeCategoryShortcut({ image, onClick }: Props) {
  return (
    <button type="button" className="flex-shrink-0 active:scale-[0.98] transition-transform" onClick={onClick}>
      <img
        src={image}
        alt=""
        draggable={false}
        className="h-[60px] w-[111px] rounded-xl object-cover shadow-[0_6px_14px_rgba(0,0,0,0.16)]"
      />
    </button>
  )
}
