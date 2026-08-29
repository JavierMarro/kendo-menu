# Recursive training activities

KendoMenu uses one recursive `Activity` model instead of flattening content or fixing the runtime
tree at three levels. Stable IDs and source order are preserved at every depth, so web and future
mobile clients can share traversal, quantities, validation, and persistence contracts as the
catalogue grows.
