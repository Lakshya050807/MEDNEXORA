import Icon from './Icon.jsx';

export default function CategoryCard({ category, onSelect }) {
  return (
    <a
      className="category-card"
      href="#featured"
      onClick={() => onSelect(category.id)}
    >
      <span className="category-icon"><Icon name={category.icon} size={22} /></span>
      <span className="category-copy">
        <span className="category-title">{category.title}</span>
        <span className="category-description">{category.description}</span>
      </span>
      <Icon name="arrowUpRight" size={17} className="category-arrow" />
    </a>
  );
}

