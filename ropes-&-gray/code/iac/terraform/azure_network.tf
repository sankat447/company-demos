# azure_network.tf – VNet, subnet, NSG, public IP for Azure demo estate

resource "azurerm_resource_group" "demo" {
  name     = "rg-${local.prefix}"
  location = var.azure_location
  tags     = local.tags
}

resource "azurerm_virtual_network" "demo" {
  name                = "vnet-${local.prefix}"
  address_space       = ["10.20.0.0/16"]
  location            = azurerm_resource_group.demo.location
  resource_group_name = azurerm_resource_group.demo.name
  tags                = local.tags
}

resource "azurerm_subnet" "windows" {
  name                 = "snet-windows-targets"
  resource_group_name  = azurerm_resource_group.demo.name
  virtual_network_name = azurerm_virtual_network.demo.name
  address_prefixes     = ["10.20.1.0/24"]
}

# ── Public IP for Windows target (WinRM + RDP access) ─────────────────────────
resource "azurerm_public_ip" "windows_target" {
  name                = "pip-win-target-${local.prefix}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

# ── NSG: allow WinRM from AAP EIP, RDP from operator only ────────────────────
resource "azurerm_network_security_group" "windows_target" {
  name                = "nsg-win-target-${local.prefix}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location

  # WinRM HTTPS – from AAP Elastic IP (Ansible connects here)
  security_rule {
    name                       = "AllowWinRM-from-AAP"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5986"
    source_address_prefix      = aws_eip.aap.public_ip   # Only from AAP
    destination_address_prefix = "*"
  }

  # RDP – operator access for manual verification during demo
  security_rule {
    name                       = "AllowRDP-from-Operator"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3389"
    source_address_prefix      = var.operator_cidr
    destination_address_prefix = "*"
  }

  # WinRM from operator – for local ansible-playbook testing before demo
  security_rule {
    name                       = "AllowWinRM-from-Operator"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "5986"
    source_address_prefix      = var.operator_cidr
    destination_address_prefix = "*"
  }

  # Deny all other inbound
  security_rule {
    name                       = "DenyAllOtherInbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = local.tags
}

resource "azurerm_network_interface" "windows_target" {
  name                = "nic-win-target-${local.prefix}"
  resource_group_name = azurerm_resource_group.demo.name
  location            = azurerm_resource_group.demo.location

  ip_configuration {
    name                          = "ipconfig1"
    subnet_id                     = azurerm_subnet.windows.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.windows_target.id
  }

  tags = local.tags
}

resource "azurerm_network_interface_security_group_association" "windows_target" {
  network_interface_id      = azurerm_network_interface.windows_target.id
  network_security_group_id = azurerm_network_security_group.windows_target.id
}
